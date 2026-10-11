// Kontrola portů: kdo poslouchá, jestli je port volný, TCP health check.
import { execFile } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import { promisify } from 'node:util';
import type { PortOwner } from '@startsite/shared';
import { isWindows } from './config.js';

const run = promisify(execFile);

/** Mapa port -> PID všech TCP listenerů v systému. */
export async function listListeners(): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  try {
    if (isWindows) {
      const { stdout } = await run('netstat', ['-ano', '-p', 'TCP'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      const { stdout: v6 } = await run('netstat', ['-ano', '-p', 'TCPv6'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      for (const line of (stdout + '\n' + v6).split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5 || parts[3] !== 'LISTENING') continue;
        const port = Number(parts[1].slice(parts[1].lastIndexOf(':') + 1));
        const pid = Number(parts[4]);
        if (port && !map.has(port)) map.set(port, pid);
      }
    } else {
      const { stdout } = await run('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']);
      let pid = 0;
      for (const line of stdout.split('\n')) {
        if (line.startsWith('p')) pid = Number(line.slice(1));
        else if (line.startsWith('n')) {
          const port = Number(line.slice(line.lastIndexOf(':') + 1));
          if (port && !map.has(port)) map.set(port, pid);
        }
      }
    }
  } catch {
    // netstat/lsof nemusí být k dispozici, zůstane jen test bindem
  }
  return map;
}

export async function processName(pid: number): Promise<string> {
  try {
    if (isWindows) {
      const { stdout } = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { windowsHide: true });
      const m = stdout.match(/^"([^"]+)"/m);
      return m ? m[1] : 'neznámý';
    }
    const { stdout } = await run('ps', ['-p', String(pid), '-o', 'comm=']);
    return stdout.trim() || 'neznámý';
  } catch {
    return 'neznámý';
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Zkusí port obsadit. Odhalí i porty rezervované systémem (Hyper-V, WSL). */
function canBind(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.unref();
    srv.once('error', () => resolve(false));
    srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
  });
}

export async function checkPort(port: number, listeners?: Map<number, number>): Promise<{ free: boolean; owner?: PortOwner }> {
  const map = listeners ?? (await listListeners());
  const pid = map.get(port);
  if (pid !== undefined) {
    return { free: false, owner: { pid, name: pid === 0 ? 'System' : await processName(pid) } };
  }
  if (!(await canBind(port, '127.0.0.1'))) {
    return { free: false, owner: { pid: 0, name: 'rezervováno systémem' } };
  }
  return { free: true };
}

export async function findFreePort(
  start = 5100,
  exclude: Set<number> = new Set(),
  known?: Map<number, number>,
): Promise<number> {
  const listeners = known ?? (await listListeners());
  for (let port = Math.max(1024, start); port < 65535; port++) {
    if (exclude.has(port) || listeners.has(port)) continue;
    if (await canBind(port, '127.0.0.1')) return port;
  }
  throw new Error('Nenašel jsem volný port');
}

function probe(port: number, host: string, timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** Odpovídá něco na portu? Vite a spol. často poslouchají jen na ::1, proto obě rodiny. */
export async function isPortResponding(port: number, timeout = 800): Promise<boolean> {
  const [v4, v6] = await Promise.all([probe(port, '127.0.0.1', timeout), probe(port, '::1', timeout)]);
  return v4 || v6;
}
