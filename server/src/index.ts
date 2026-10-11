import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply } from 'fastify';
import type { Framework, Project, ProjectInput, ProjectKind, ProjectPatch, ServerEvent } from '@startsite/shared';
import { host, port, webDist } from './config.js';
import { detectProject, findComposeFile, readComposeServices } from './detect.js';
import { bus, stripAnsi } from './logs.js';
import { checkPort, findFreePort } from './ports.js';
import { ProcessManager, StartSiteError } from './process-manager.js';
import { slugify, Store } from './store.js';

const KINDS: ProjectKind[] = ['npm', 'compose', 'dockerfile', 'dotnet', 'static', 'custom'];
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn'] as const;

/** ID závislostí: musí existovat a nesmí ukazovat samy na sebe. Přijme i názvy. */
function cleanDependsOn(value: unknown, selfId?: string): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const ref of value) {
    const dep = store.find(String(ref));
    if (!dep) throw new StartSiteError('dependency_missing', `Závislost "${ref}" neexistuje`);
    if (dep.id === selfId) throw new StartSiteError('dependency_self', 'Projekt nemůže záviset sám na sobě');
    if (!ids.includes(dep.id)) ids.push(dep.id);
  }
  return ids;
}
const FRAMEWORKS: Framework[] = ['vite', 'astro', 'sveltekit', 'next', 'other'];

const store = new Store();
await store.load();
const manager = new ProcessManager(store);

const app = Fastify({ logger: { level: process.env.STARTSITE_LOG ?? 'warn' } });

// Ochrana proti DNS rebindingu a požadavkům z cizích webů: API běží jen pro localhost.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.addHook('onRequest', async (req, reply) => {
  const hostHeader = req.headers.host ?? '';
  const origin = req.headers.origin;
  if (!LOCAL_HOST.test(hostHeader)) {
    return reply.code(403).send({ error: 'forbidden', message: 'Jen pro localhost' });
  }
  if (origin && origin !== 'null') {
    try {
      if (!LOCAL_HOST.test(new URL(origin).host)) {
        return reply.code(403).send({ error: 'forbidden', message: 'Cizí origin' });
      }
    } catch {
      return reply.code(403).send({ error: 'forbidden', message: 'Neplatný origin' });
    }
  }
});

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof StartSiteError) {
    return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
  }
  const status = (err as { statusCode?: number }).statusCode ?? 500;
  return reply.code(status).send({ error: 'internal', message: (err as Error).message });
});

function mustFind(ref: string): Project {
  const p = store.find(ref);
  if (!p) throw new StartSiteError('not_found', `Projekt "${ref}" neexistuje`, 404);
  return p;
}

function validPort(value: unknown, field = 'port'): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new StartSiteError('invalid_port', `Neplatný ${field}: ${value}`);
  return n;
}

function cleanEnv(env: unknown): Record<string, string> {
  if (!env || typeof env !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    const key = k.trim();
    if (!key) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new StartSiteError('invalid_env', `Neplatný název proměnné: ${key}`);
    out[key] = String(v ?? '');
  }
  return out;
}

function ensureUniqueName(name: string, exceptId?: string) {
  const clash = store.projects.find((p) => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase());
  if (clash) throw new StartSiteError('name_taken', `Projekt "${name}" už existuje`, 409);
}

function uniqueId(name: string): string {
  const base = slugify(name);
  let id = base;
  for (let i = 2; store.projects.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** Doplní a ověří pole projektu. Volá se při vytvoření i úpravě. */
async function normalize(input: ProjectPatch, existing?: Project): Promise<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> {
  const path = (input.path ?? existing?.path ?? '').trim();
  if (!path) throw new StartSiteError('path_required', 'Chybí cesta ke složce');
  const detected = await detectProject(path);
  if (!detected.exists) throw new StartSiteError('path_missing', `Složka neexistuje: ${detected.path}`);

  const pathChanged = existing && detected.path !== existing.path;
  const base = pathChanged ? undefined : existing;
  const kind = input.kind ?? base?.kind ?? detected.kind;
  if (!KINDS.includes(kind)) throw new StartSiteError('invalid_kind', `Neznámý typ: ${kind}`);
  const name = (input.name ?? existing?.name ?? detected.name).trim();
  if (!name) throw new StartSiteError('name_required', 'Chybí název');

  const result: Omit<Project, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    path: detected.path,
    kind,
    port: validPort(input.port) ?? existing?.port ?? (await findFreePort(5100, manager.reservedPorts(existing?.id))),
    env: input.env !== undefined ? cleanEnv(input.env) : (existing?.env ?? {}),
  };
  const dependsOn = input.dependsOn !== undefined ? cleanDependsOn(input.dependsOn, existing?.id) : (existing?.dependsOn ?? []);
  if (dependsOn.length) result.dependsOn = dependsOn;
  const autoInstall = input.autoInstall ?? existing?.autoInstall;
  if (autoInstall === false) result.autoInstall = false;

  if (kind === 'npm') {
    const script = input.script ?? base?.script ?? detected.defaultScript;
    if (!script) throw new StartSiteError('script_required', 'package.json nemá žádný skript');
    if (Object.keys(detected.scripts).length && !(script in detected.scripts)) {
      throw new StartSiteError('script_missing', `Skript "${script}" v package.json není`);
    }
    result.script = script;
    const fw = input.framework ?? base?.framework ?? detected.framework ?? 'other';
    if (!FRAMEWORKS.includes(fw)) throw new StartSiteError('invalid_framework', `Neznámý framework: ${fw}`);
    result.framework = fw;
    const pm = input.packageManager ?? base?.packageManager ?? detected.packageManager ?? 'npm';
    if (!PACKAGE_MANAGERS.includes(pm)) throw new StartSiteError('invalid_package_manager', `Neznámý správce balíčků: ${pm}`);
    if (pm !== 'npm') result.packageManager = pm;
  } else if (kind === 'dotnet') {
    const projectFile = (input.projectFile ?? base?.projectFile ?? detected.projectFile ?? '').trim();
    if (!projectFile || !existsSync(join(detected.path, projectFile))) {
      throw new StartSiteError('project_file_missing', 'Ve složce není webový .csproj');
    }
    result.projectFile = projectFile;
  } else if (kind === 'static') {
    // Vestavěný statický server, nic dalšího nepotřebuje
  } else if (kind === 'custom') {
    const command = (input.command ?? base?.command ?? detected.command ?? '').trim();
    if (!command) throw new StartSiteError('command_required', 'Vlastní projekt potřebuje příkaz');
    result.command = command;
  } else {
    if (kind === 'compose') {
      const file = findComposeFile(detected.path);
      if (!file) throw new StartSiteError('compose_missing', 'Ve složce není compose soubor');
      const services = await readComposeServices(detected.path, file);
      const service = input.service ?? base?.service ?? detected.service;
      if (service && !services.some((s) => s.name === service)) {
        throw new StartSiteError('service_missing', `Služba "${service}" v compose není`);
      }
      result.service = service;
      result.containerPort =
        validPort(input.containerPort, 'port kontejneru') ??
        base?.containerPort ??
        services.find((s) => s.name === service)?.containerPort;
    } else {
      if (!existsSync(join(detected.path, 'Dockerfile'))) throw new StartSiteError('dockerfile_missing', 'Ve složce není Dockerfile');
      result.containerPort = validPort(input.containerPort, 'port kontejneru') ?? base?.containerPort ?? detected.containerPort;
    }
  }
  return result;
}

// ---------- API ----------

app.get('/api/health', async () => ({ ok: true, name: 'startsite', pid: process.pid }));

app.get('/api/projects', async () => store.projects.map((p) => manager.view(p)));

app.get<{ Params: { ref: string } }>('/api/projects/:ref', async (req) => manager.view(mustFind(req.params.ref)));

app.post<{ Body: ProjectInput }>('/api/projects', async (req, reply) => {
  const body = req.body ?? ({} as ProjectInput);
  const fields = await normalize(body);
  ensureUniqueName(fields.name);
  const now = new Date().toISOString();
  const project: Project = { id: uniqueId(fields.name), ...fields, createdAt: now, updatedAt: now };
  store.projects.push(project);
  await store.saveProjects();
  const view = manager.view(project);
  bus.emitEvent({ type: 'project', project: view });
  return reply.code(201).send(view);
});

app.patch<{ Params: { ref: string }; Body: ProjectPatch }>('/api/projects/:ref', async (req) => {
  const p = mustFind(req.params.ref);
  const fields = await normalize(req.body ?? {}, p);
  ensureUniqueName(fields.name, p.id);
  // Pole, která pro nový typ nedávají smysl, zahodíme
  delete p.script;
  delete p.command;
  delete p.framework;
  delete p.service;
  delete p.containerPort;
  delete p.projectFile;
  delete p.packageManager;
  delete p.autoInstall;
  delete p.dependsOn;
  Object.assign(p, fields, { updatedAt: new Date().toISOString() });
  await store.saveProjects();
  const view = manager.view(p);
  bus.emitEvent({ type: 'project', project: view });
  return view;
});

app.delete<{ Params: { ref: string } }>('/api/projects/:ref', async (req) => {
  const p = mustFind(req.params.ref);
  const view = manager.view(p);
  await manager.forget(p.id);
  store.projects = store.projects.filter((x) => x.id !== p.id);
  // Smazaný projekt už nemůže být závislostí jiných
  for (const other of store.projects) {
    if (other.dependsOn?.includes(p.id)) {
      other.dependsOn = other.dependsOn.filter((d) => d !== p.id);
      bus.emitEvent({ type: 'project', project: manager.view(other) });
    }
  }
  await store.saveProjects();
  await store.setRuntime(p.id, undefined);
  bus.emitEvent({ type: 'removed', id: p.id });
  return { removed: view };
});

app.post<{ Params: { ref: string }; Body: { port?: number; wait?: boolean } | null; Querystring: { wait?: string } }>(
  '/api/projects/:ref/start',
  async (req) => {
    const p = mustFind(req.params.ref);
    const wait = req.body?.wait ?? req.query.wait === '1';
    return manager.start(p.id, { port: validPort(req.body?.port), wait });
  },
);

app.post<{ Params: { ref: string } }>('/api/projects/:ref/stop', async (req) => manager.stop(mustFind(req.params.ref).id));

app.post<{ Params: { ref: string } }>('/api/projects/:ref/restart', async (req) => manager.restart(mustFind(req.params.ref).id));

app.get<{ Params: { ref: string }; Querystring: { limit?: string; plain?: string } }>('/api/projects/:ref/logs', async (req) => {
  const p = mustFind(req.params.ref);
  const limit = Number(req.query.limit ?? 2000) || 2000;
  let lines = manager.logBuffer(p.id).tail(limit);
  if (req.query.plain === '1') lines = lines.map((l) => ({ ...l, text: stripAnsi(l.text) }));
  return { project: manager.view(p), lines };
});

app.delete<{ Params: { ref: string } }>('/api/projects/:ref/logs', async (req) => {
  manager.logBuffer(mustFind(req.params.ref).id).clear();
  return { ok: true };
});

app.post<{ Body: { path?: string } }>('/api/detect', async (req) => {
  if (!req.body?.path) throw new StartSiteError('path_required', 'Chybí cesta');
  return detectProject(req.body.path);
});

app.get<{ Querystring: { start?: string; exclude?: string } }>('/api/ports/free', async (req) => {
  const start = validPort(req.query.start) ?? 5100;
  return { port: await findFreePort(start, manager.reservedPorts(req.query.exclude)) };
});

app.get<{ Params: { port: string } }>('/api/ports/:port', async (req) => {
  const n = validPort(req.params.port)!;
  const result = await checkPort(n);
  const project = store.projects.find((p) => p.port === n)?.name;
  return { port: n, ...result, project };
});

// Server-Sent Events: stavy projektů a řádky logů
app.get('/api/events', (req, reply: FastifyReply) => {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 2000\n\n');
  const send = (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  bus.on('event', send);
  req.raw.on('close', () => {
    clearInterval(heartbeat);
    bus.off('event', send);
  });
});

// ---------- frontend ----------

if (existsSync(join(webDist, 'index.html'))) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  const indexHtml = await readFile(join(webDist, 'index.html'), 'utf8');
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found', message: 'Neznámý endpoint' });
    return reply.type('text/html').send(indexHtml);
  });
}

// ---------- start ----------

await manager.reconcile();
manager.startWatchdog();

try {
  await app.listen({ host, port });
  console.log(`StartSite běží na http://${host}:${port}`);
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${port} je obsazený. StartSite už možná běží, nebo nastav STARTSITE_PORT.`);
    process.exit(1);
  }
  throw err;
}

const shutdown = async () => {
  manager.detachAll();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
