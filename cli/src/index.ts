// CLI: startsite list | start | stop | restart | logs | add | port
import type { LogLine, ProjectView, ServerEvent } from '@startsite/shared';
import { ApiRequestError, StartSiteClient } from '@startsite/shared/client';

const client = new StartSiteClient();
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: number, s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);

const STATUS: Record<string, string> = {
  running: paint(32, 'běží'),
  starting: paint(33, 'startuje'),
  stopped: paint(90, 'zastaveno'),
  error: paint(31, 'chyba'),
};

const HELP = `StartSite CLI

Použití:
  startsite list                         seznam projektů
  startsite start <název> [--port N]     spustí projekt a počká na port
  startsite stop <název>                 zastaví projekt
  startsite restart <název>              restart
  startsite status <název>               stav a URL
  startsite logs <název> [-n 100] [-f]   výpis logů, -f sleduje živě
  startsite add <cesta> [--name X] [--port N]
  startsite port [od]                    najde volný port

Projekt jde zadat názvem i ID, na velikosti písmen nezáleží.
Backend: ${client.baseUrl} (STARTSITE_PORT), když neběží, CLI ho spustí.`;

function parseFlags(args: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-')) {
      const key = a.replace(/^-+/, '');
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-') && !['f', 'follow'].includes(key)) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else positional.push(a);
  }
  return { positional, flags };
}

function line(p: ProjectView) {
  const parts = [`${p.name} (${p.id})`, STATUS[p.runtime.status] ?? p.runtime.status, p.url];
  if (p.runtime.pid) parts.push(`PID ${p.runtime.pid}`);
  return parts.join('  ');
}

function printProject(p: ProjectView) {
  console.log(line(p));
  if (p.runtime.error) console.log(paint(31, `  ${p.runtime.error}`));
  if (p.runtime.suggestedPort) console.log(`  Zkus: startsite start ${JSON.stringify(p.name)} --port ${p.runtime.suggestedPort}`);
}

function printLog(l: LogLine) {
  const prefix = l.stream === 'system' ? paint(90, '[startsite] ') : '';
  const text = color ? l.text : l.text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
  console.log(l.error ? `${prefix}${paint(31, text)}` : `${prefix}${text}`);
}

function need(name: string | undefined, usage: string): string {
  if (!name) {
    console.error(`Použití: ${usage}`);
    process.exit(2);
  }
  return name;
}

async function follow(ref: string) {
  const project = await client.get(ref);
  const res = await fetch(`${client.baseUrl}/api/events`);
  if (!res.body) throw new Error('Stream logů není dostupný');
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const raw of events) {
      const data = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!data) continue;
      const event = JSON.parse(data.slice(6)) as ServerEvent;
      if (event.type === 'log' && event.id === project.id) printLog(event.line);
    }
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);
  const ref = positional.join(' ') || undefined;

  switch (cmd) {
    case 'list':
    case 'ls': {
      const list = await client.list();
      if (!list.length) console.log('Žádné projekty. Přidej: startsite add <cesta>');
      for (const p of list) console.log(line(p));
      break;
    }
    case 'start': {
      const port = flags.port ? Number(flags.port) : undefined;
      const p = await client.start(need(ref, 'startsite start <název> [--port N]'), { port, wait: true });
      printProject(p);
      if (p.runtime.status !== 'running') process.exitCode = 1;
      break;
    }
    case 'stop':
      printProject(await client.stop(need(ref, 'startsite stop <název>')));
      break;
    case 'restart': {
      const p = await client.restart(need(ref, 'startsite restart <název>'));
      printProject(p);
      if (p.runtime.status !== 'running') process.exitCode = 1;
      break;
    }
    case 'status':
      printProject(await client.get(need(ref, 'startsite status <název>')));
      break;
    case 'logs': {
      const name = need(ref, 'startsite logs <název> [-n 100] [-f]');
      const n = Number(flags.n ?? flags.lines ?? 100);
      const { lines } = await client.logs(name, n, !color);
      lines.forEach(printLog);
      if (flags.f || flags.follow) await follow(name);
      break;
    }
    case 'add': {
      const path = need(positional[0], 'startsite add <cesta> [--name X] [--port N]');
      const p = await client.add({
        path,
        name: typeof flags.name === 'string' ? flags.name : undefined,
        port: flags.port ? Number(flags.port) : undefined,
      });
      console.log(`Přidáno: ${line(p)}`);
      console.log(`  ${p.resolvedCommand}`);
      break;
    }
    case 'port': {
      const { port } = await client.freePort(positional[0] ? Number(positional[0]) : undefined);
      console.log(port);
      break;
    }
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`Neznámý příkaz: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 2;
  }
}

main().catch((err) => {
  if (err instanceof ApiRequestError) {
    console.error(paint(31, err.body.message ?? err.message));
    if (err.body.suggestedPort) console.error(`Volný port: ${err.body.suggestedPort} (startsite start <název> --port ${err.body.suggestedPort})`);
  } else {
    console.error(paint(31, (err as Error).message));
  }
  process.exit(1);
});
