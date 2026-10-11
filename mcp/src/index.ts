// MCP server (stdio). Volá HTTP API běžícího backendu, takže UI i Claude vidí stejný stav.
// Na stdout smí jen MCP protokol, diagnostika jde na stderr.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ProjectView } from '@startsite/shared';
import { ApiRequestError, StartSiteClient } from '@startsite/shared/client';

const client = new StartSiteClient();

function summary(p: ProjectView) {
  return {
    id: p.id,
    name: p.name,
    kind: p.kind,
    status: p.runtime.status,
    url: p.url,
    port: p.port,
    pid: p.runtime.pid,
    path: p.path,
    command: p.resolvedCommand,
    ...(p.runtime.error ? { error: p.runtime.error } : {}),
    ...(p.runtime.portOwner ? { portOwner: p.runtime.portOwner, suggestedPort: p.runtime.suggestedPort } : {}),
  };
}

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** Chyby API vrátíme jako výsledek nástroje s isError, ať Claude vidí důvod (např. obsazený port). */
async function call(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (err) {
    const body = err instanceof ApiRequestError ? err.body : { error: 'error', message: (err as Error).message };
    return { ...ok(body), isError: true };
  }
}

const projectRef = z.string().describe('Název nebo ID projektu (bez ohledu na velikost písmen)');
const kind = z.enum(['npm', 'compose', 'dockerfile', 'dotnet', 'static', 'custom']);
// Společná pole pro add_project a update_project
const extraFields = {
  dependsOn: z.array(z.string()).optional().describe('Projekty (název nebo ID), které se musí spustit dřív, např. API před frontendem'),
  autoInstall: z.boolean().optional().describe('Doinstalovat chybějící node_modules před startem, výchozí true'),
  projectFile: z.string().optional().describe('dotnet: cesta k webovému .csproj relativně ke složce'),
  packageManager: z.enum(['npm', 'pnpm', 'yarn']).optional(),
};
const framework = z.enum(['vite', 'astro', 'sveltekit', 'next', 'other']);
const port = z.number().int().min(1).max(65535);

const server = new McpServer({ name: 'startsite', version: '0.1.0' });

server.registerTool(
  'list_projects',
  {
    description: 'Vypíše všechny projekty ve StartSite se stavem (stopped/starting/running/error), portem a URL.',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  () => call(async () => (await client.list()).map(summary)),
);

server.registerTool(
  'get_project',
  {
    description: 'Detail projektu: stav, URL, příkaz, env proměnné.',
    inputSchema: { project: projectRef },
    annotations: { readOnlyHint: true },
  },
  ({ project }) =>
    call(async () => {
      const p = await client.get(project);
      return { ...summary(p), env: p.env, script: p.script, framework: p.framework, containerPort: p.containerPort, service: p.service };
    }),
);

server.registerTool(
  'add_project',
  {
    description:
      'Přidá projekt ze složky. Typ, název a skript se rozpoznají automaticky (package.json, docker-compose.yml, Dockerfile, .csproj, index.html, Python, PHP). ' +
      'Bez portu se vybere volný. Pro vlastní příkaz použij kind=custom a command (placeholder {port}).',
    inputSchema: {
      path: z.string().describe('Absolutní cesta ke složce projektu'),
      name: z.string().optional(),
      kind: kind.optional(),
      script: z.string().optional().describe('npm skript, výchozí dev'),
      command: z.string().optional().describe('Jen pro kind=custom'),
      framework: framework.optional(),
      port: port.optional(),
      containerPort: port.optional().describe('Docker: port uvnitř kontejneru'),
      service: z.string().optional().describe('compose: služba, na kterou se mapuje port'),
      env: z.record(z.string()).optional(),
      ...extraFields,
    },
  },
  (input) => call(async () => summary(await client.add(input))),
);

server.registerTool(
  'update_project',
  {
    description: 'Upraví projekt (název, port, příkaz, env...). Změna portu běžícího projektu se projeví po restartu.',
    inputSchema: {
      project: projectRef,
      name: z.string().optional(),
      path: z.string().optional(),
      kind: kind.optional(),
      script: z.string().optional(),
      command: z.string().optional(),
      framework: framework.optional(),
      port: port.optional(),
      containerPort: port.optional(),
      service: z.string().optional(),
      env: z.record(z.string()).optional().describe('Nahradí všechny env proměnné'),
      ...extraFields,
    },
  },
  ({ project, ...patch }) => call(async () => summary(await client.update(project, patch))),
);

server.registerTool(
  'remove_project',
  {
    description: 'Odebere projekt ze StartSite (běžící zastaví). Soubory na disku nemaže.',
    inputSchema: { project: projectRef },
    annotations: { destructiveHint: true },
  },
  ({ project }) => call(async () => ({ removed: summary((await client.remove(project)).removed) })),
);

server.registerTool(
  'start_project',
  {
    description:
      'Spustí projekt a počká, až port odpovídá. Vrátí stav a URL. Když je port obsazený, vrátí kdo ho drží a volný port; ' +
      'start pak zopakuj s parametrem port.',
    inputSchema: {
      project: projectRef,
      port: port.optional().describe('Jiný port (uloží se do projektu)'),
    },
  },
  ({ project, port }) => call(async () => summary(await client.start(project, { port, wait: true }))),
);

server.registerTool(
  'stop_project',
  {
    description: 'Zastaví projekt včetně všech podprocesů (nebo docker compose down / docker stop) a uvolní port.',
    inputSchema: { project: projectRef },
  },
  ({ project }) => call(async () => summary(await client.stop(project))),
);

server.registerTool(
  'restart_project',
  {
    description: 'Zastaví a znovu spustí projekt, počká na port.',
    inputSchema: { project: projectRef },
  },
  ({ project }) => call(async () => summary(await client.restart(project))),
);

server.registerTool(
  'get_logs',
  {
    description: 'Posledních N řádků výstupu projektu (stdout/stderr, bez ANSI barev). Řádky s chybou začínají "!".',
    inputSchema: {
      project: projectRef,
      lines: z.number().int().min(1).max(2000).optional().describe('Počet řádků, výchozí 100'),
    },
    annotations: { readOnlyHint: true },
  },
  ({ project, lines }) =>
    call(async () => {
      const { project: p, lines: rows } = await client.logs(project, lines ?? 100);
      return {
        ...summary(p),
        logs: rows.map((l) => `${l.error ? '!' : ' '} ${l.stream === 'system' ? '[startsite] ' : ''}${l.text}`).join('\n'),
      };
    }),
);

server.registerTool(
  'find_free_port',
  {
    description: 'Najde volný port (nepoužívaný v systému ani jiným projektem StartSite).',
    inputSchema: { start: z.number().int().min(1024).max(65535).optional().describe('Od kterého portu hledat, výchozí 5100') },
    annotations: { readOnlyHint: true },
  },
  ({ start }) =>
    call(async () => {
      const { port } = await client.freePort(start);
      return { port, url: `http://localhost:${port}` };
    }),
);

await server.connect(new StdioServerTransport());
console.error(`StartSite MCP připojen, backend ${client.baseUrl}`);
