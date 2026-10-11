// Spouštění, zastavování a hlídání projektů.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { projectUrl, type PortOwner, type Project, type ProjectStatus, type ProjectView } from '@startsite/shared';
import { dataDir, isWindows } from './config.js';
import { findComposeFile } from './detect.js';
import { bus, LogBuffer } from './logs.js';
import { checkPort, findFreePort, isPidAlive, isPortResponding, listListeners, processName } from './ports.js';
import type { RuntimeRecord, Store } from './store.js';

const run = promisify(execFile);

const START_TIMEOUT_MS = { npm: 180_000, custom: 180_000, compose: 300_000, dockerfile: 300_000 } as const;
const SHELL_NAMES = /^(cmd|node|npm|npx|pnpm|yarn|bun|conhost|sh|bash|zsh|powershell|pwsh)(\.exe)?$/i;

export class StartSiteError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

interface RunState {
  status: ProjectStatus;
  pid?: number;
  startedAt?: string;
  error?: string;
  portOwner?: PortOwner;
  suggestedPort?: number;
  /** Hlavní proces (npm/custom) */
  child?: ChildProcess;
  /** Sledování logů Dockeru */
  logChild?: ChildProcess;
  /** Port, na kterém projekt opravdu běží (může se lišit od uloženého po úpravě) */
  activePort?: number;
  stopping?: boolean;
  /** Proces převzatý z minulé relace, nemáme jeho stdout */
  adopted?: boolean;
  generation: number;
}

function dockerNames(p: Project) {
  return { container: `startsite-${p.id}`, image: `startsite-${p.id}`, composeProject: `startsite-${p.id}` };
}

function npmPortArgs(p: Project, port: number): string {
  switch (p.framework) {
    case 'vite':
    case 'astro':
    case 'sveltekit':
      return ` -- --port ${port} --strictPort`;
    case 'next':
      return ` -- -p ${port}`;
    default:
      return '';
  }
}

/** Proměnné prostředí pro projekt. Odstraní npm_* z StartSite, aby nepletly vnořené npm. */
function projectEnv(p: Project, port: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^npm_/i.test(k) || k === 'INIT_CWD' || k.startsWith('STARTSITE_')) continue;
    env[k] = v;
  }
  return { ...env, FORCE_COLOR: '1', ...p.env, PORT: String(port) };
}

function dockerError(output: string): string | undefined {
  if (/failed to connect to the docker API|docker daemon is not running|error during connect|dockerDesktopLinuxEngine/i.test(output)) {
    return 'Docker neběží. Spusť Docker Desktop.';
  }
  return undefined;
}

export class ProcessManager {
  private states = new Map<string, RunState>();
  private logs = new Map<string, LogBuffer>();
  private locks = new Map<string, Promise<unknown>>();
  private watchdog?: NodeJS.Timeout;

  constructor(private store: Store) {}

  logBuffer(id: string): LogBuffer {
    let buf = this.logs.get(id);
    if (!buf) {
      buf = new LogBuffer(id);
      this.logs.set(id, buf);
    }
    return buf;
  }

  private state(id: string): RunState {
    let s = this.states.get(id);
    if (!s) {
      s = { status: 'stopped', generation: 0 };
      this.states.set(id, s);
    }
    return s;
  }

  /** Operace nad jedním projektem běží postupně, aby se start a stop nepotkaly. */
  private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      id,
      next.catch(() => undefined),
    );
    return next;
  }

  resolvedCommand(p: Project, port = p.port): string {
    switch (p.kind) {
      case 'npm':
        return `npm run ${p.script ?? 'dev'}${npmPortArgs(p, port)}`;
      case 'custom':
        return (p.command ?? '').replaceAll('{port}', String(port));
      case 'compose': {
        const file = findComposeFile(p.path) ?? 'compose.yaml';
        return `docker compose -p ${dockerNames(p).composeProject} -f ${file} up -d  (port ${port}:${p.containerPort ?? '?'}${p.service ? `, služba ${p.service}` : ''})`;
      }
      case 'dockerfile': {
        const n = dockerNames(p);
        return `docker build -t ${n.image} . && docker run -d --rm --name ${n.container} -p ${port}:${p.containerPort ?? '?'} ${n.image}`;
      }
    }
  }

  view(p: Project): ProjectView {
    const s = this.state(p.id);
    const port = s.status === 'stopped' || s.status === 'error' ? p.port : (s.activePort ?? p.port);
    return {
      ...p,
      url: projectUrl(port),
      resolvedCommand: this.resolvedCommand(p, port),
      runtime: {
        status: s.status,
        pid: s.pid,
        startedAt: s.startedAt,
        error: s.error,
        portOwner: s.portOwner,
        suggestedPort: s.suggestedPort,
      },
    };
  }

  private publish(id: string) {
    const p = this.store.projects.find((x) => x.id === id);
    if (p) bus.emitEvent({ type: 'project', project: this.view(p) });
  }

  private setStatus(id: string, patch: Partial<RunState>) {
    Object.assign(this.state(id), patch);
    this.publish(id);
  }

  isActive(id: string) {
    const s = this.states.get(id);
    return s?.status === 'running' || s?.status === 'starting';
  }

  /** Porty, které mají ostatní projekty v konfiguraci, aby je find_free_port nenabízel. */
  reservedPorts(exceptId?: string): Set<number> {
    return new Set(this.store.projects.filter((p) => p.id !== exceptId).map((p) => p.port));
  }

  // ---------- start ----------

  start(id: string, opts: { port?: number; wait?: boolean } = {}): Promise<ProjectView> {
    const started = this.withLock(id, () => this.doStart(id, opts.port));
    if (!opts.wait) return started;
    return started.then(() => this.waitSettled(id));
  }

  /** Počká, až projekt doběhne do running nebo error. */
  async waitSettled(id: string, timeout = 300_000): Promise<ProjectView> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const s = this.state(id);
      if (s.status !== 'starting') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return this.view(this.mustGet(id));
  }

  private mustGet(id: string): Project {
    const p = this.store.projects.find((x) => x.id === id);
    if (!p) throw new StartSiteError('not_found', 'Projekt neexistuje', 404);
    return p;
  }

  private async doStart(id: string, portOverride?: number): Promise<ProjectView> {
    const p = this.mustGet(id);
    const s = this.state(id);
    if (s.status === 'running' || s.status === 'starting') return this.view(p);

    if (portOverride && portOverride !== p.port) {
      p.port = portOverride;
      p.updatedAt = new Date().toISOString();
      await this.store.saveProjects();
    }
    if (!existsSync(p.path)) {
      this.setStatus(id, { status: 'error', error: `Složka neexistuje: ${p.path}`, portOwner: undefined, suggestedPort: undefined });
      throw new StartSiteError('path_missing', `Složka neexistuje: ${p.path}`);
    }
    if ((p.kind === 'compose' || p.kind === 'dockerfile') && !p.containerPort) {
      const msg = 'Chybí port v kontejneru. Doplň ho v nastavení projektu.';
      this.setStatus(id, { status: 'error', error: msg });
      throw new StartSiteError('container_port_required', msg);
    }
    if (p.kind === 'custom' && !p.command?.trim()) {
      throw new StartSiteError('command_required', 'Projekt nemá příkaz');
    }

    const port = p.port;
    const listeners = await listListeners();
    const check = await checkPort(port, listeners);
    if (!check.free) {
      const suggestedPort = await findFreePort(port + 1, this.reservedPorts(id), listeners);
      const owner = check.owner!;
      const message = `Port ${port} drží ${owner.name} (PID ${owner.pid}). Volný je ${suggestedPort}.`;
      this.logBuffer(id).system(message);
      this.setStatus(id, { status: 'error', error: message, portOwner: owner, suggestedPort, pid: undefined });
      throw new StartSiteError('port_in_use', message, 409, { port, owner, suggestedPort });
    }

    const generation = s.generation + 1;
    this.setStatus(id, {
      status: 'starting',
      error: undefined,
      portOwner: undefined,
      suggestedPort: undefined,
      pid: undefined,
      startedAt: new Date().toISOString(),
      activePort: port,
      stopping: false,
      adopted: false,
      child: undefined,
      logChild: undefined,
      generation,
    });
    const log = this.logBuffer(id);
    log.system(`Spouštím: ${this.resolvedCommand(p, port)}`);

    try {
      if (p.kind === 'npm' || p.kind === 'custom') {
        this.spawnShell(p, port, generation);
      } else {
        // Docker kroky trvají dlouho (build), běží na pozadí ve stavu "startuje".
        void this.startDocker(p, port, generation).catch((err) => this.fail(id, generation, err));
      }
    } catch (err) {
      this.fail(id, generation, err);
      throw err;
    }
    void this.healthCheck(p, port, generation);
    return this.view(p);
  }

  private fail(id: string, generation: number, err: unknown) {
    const s = this.state(id);
    if (s.generation !== generation || s.stopping) return;
    const message = err instanceof Error ? err.message : String(err);
    this.logBuffer(id).system(`Chyba: ${message}`);
    this.setStatus(id, { status: 'error', error: message });
  }

  private spawnShell(p: Project, port: number, generation: number) {
    const cmd = this.resolvedCommand(p, port);
    const child = spawn(cmd, {
      cwd: p.path,
      env: projectEnv(p, port),
      shell: true,
      windowsHide: true,
      // Na Unixu vlastní skupina procesů, aby šel zabít celý strom
      detached: !isWindows,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const log = this.logBuffer(p.id);
    child.stdout?.on('data', (d) => log.write('stdout', d));
    child.stderr?.on('data', (d) => log.write('stderr', d));
    child.on('error', (err) => this.fail(p.id, generation, err));
    child.on('exit', (code, signal) => {
      log.flush();
      const s = this.state(p.id);
      if (s.generation !== generation) return;
      s.child = undefined;
      if (s.stopping) return; // stop() si stav nastaví sám
      void this.store.setRuntime(p.id, undefined);
      if (code === 0) {
        log.system('Proces skončil.');
        this.setStatus(p.id, { status: 'stopped', pid: undefined });
      } else {
        const msg = `Proces skončil s kódem ${code ?? signal}`;
        log.system(msg);
        this.setStatus(p.id, { status: 'error', error: msg, pid: undefined });
      }
    });
    this.setStatus(p.id, { child, pid: child.pid });
    void this.store.setRuntime(p.id, { kind: p.kind, port, startedAt: new Date().toISOString(), pid: child.pid });
  }

  /** Spustí příkaz (docker ...) a jeho výstup pošle do logu. Vrátí exit kód a výstup. */
  private runStep(p: Project, args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const log = this.logBuffer(p.id);
      log.system(`$ docker ${args.join(' ')}`);
      const child = spawn('docker', args, { cwd: p.path, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const onData = (stream: 'stdout' | 'stderr') => (d: Buffer) => {
        output += d.toString();
        if (output.length > 64_000) output = output.slice(-32_000);
        log.write(stream, d);
      };
      child.stdout.on('data', onData('stdout'));
      child.stderr.on('data', onData('stderr'));
      child.on('error', (err) => reject(new Error(`docker nejde spustit: ${err.message}`)));
      child.on('exit', (code) => {
        log.flush();
        resolve({ code: code ?? 1, output });
      });
    });
  }

  private async composeFiles(p: Project, port: number): Promise<string[]> {
    const file = findComposeFile(p.path);
    if (!file) throw new Error('Ve složce není compose soubor');
    const files = ['-f', file];
    if (p.service && p.containerPort) {
      const dir = join(dataDir, 'compose');
      await mkdir(dir, { recursive: true });
      const override = join(dir, `${p.id}.override.yml`);
      // !override nahradí porty služby místo sloučení (compose 2.24+)
      await writeFile(
        override,
        `services:\n  ${JSON.stringify(p.service)}:\n    ports: !override\n      - "${port}:${p.containerPort}"\n`,
        'utf8',
      );
      files.push('-f', override);
    }
    return ['compose', '-p', dockerNames(p).composeProject, ...files];
  }

  private async startDocker(p: Project, port: number, generation: number) {
    const env = projectEnv(p, port);
    const n = dockerNames(p);
    const alive = () => this.state(p.id).generation === generation && !this.state(p.id).stopping;
    let followArgs: string[];

    if (p.kind === 'compose') {
      const base = await this.composeFiles(p, port);
      await this.store.setRuntime(p.id, { kind: p.kind, port, startedAt: new Date().toISOString(), composeProject: n.composeProject });
      const up = await this.runStep(p, [...base, 'up', '-d', '--remove-orphans'], env);
      if (up.code !== 0) throw new Error(dockerError(up.output) ?? `docker compose up skončil s kódem ${up.code}`);
      followArgs = [...base, 'logs', '-f', '--tail', '50'];
    } else {
      const build = await this.runStep(p, ['build', '-t', n.image, '.'], env);
      if (build.code !== 0) throw new Error(dockerError(build.output) ?? `docker build skončil s kódem ${build.code}`);
      if (!alive()) return;
      await this.runStep(p, ['rm', '-f', n.container], env);
      const envArgs = Object.entries(p.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      await this.store.setRuntime(p.id, { kind: p.kind, port, startedAt: new Date().toISOString(), container: n.container });
      const runRes = await this.runStep(
        p,
        ['run', '-d', '--rm', '--name', n.container, '-p', `${port}:${p.containerPort}`, '-e', `PORT=${p.containerPort}`, ...envArgs, n.image],
        env,
      );
      if (runRes.code !== 0) throw new Error(dockerError(runRes.output) ?? `docker run skončil s kódem ${runRes.code}`);
      followArgs = ['logs', '-f', '--tail', '50', n.container];
    }
    if (!alive()) return;
    this.followDockerLogs(p, followArgs, env);
  }

  private followDockerLogs(p: Project, args: string[], env: NodeJS.ProcessEnv) {
    const log = this.logBuffer(p.id);
    const child = spawn('docker', args, { cwd: p.path, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log.write('stdout', d));
    child.stderr.on('data', (d) => log.write('stderr', d));
    child.on('error', () => undefined);
    this.state(p.id).logChild = child;
  }

  private async healthCheck(p: Project, port: number, generation: number) {
    const deadline = Date.now() + START_TIMEOUT_MS[p.kind];
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const s = this.state(p.id);
      if (s.generation !== generation || s.status !== 'starting' || s.stopping) return;
      if (await isPortResponding(port)) {
        const again = this.state(p.id);
        if (again.generation !== generation || again.status !== 'starting') return;
        this.logBuffer(p.id).system(`Běží na ${projectUrl(port)}`);
        this.setStatus(p.id, { status: 'running' });
        return;
      }
    }
    const s = this.state(p.id);
    if (s.generation !== generation || s.status !== 'starting') return;
    const msg = `Port ${port} neodpověděl do ${START_TIMEOUT_MS[p.kind] / 1000} s. Projekt zastavuji.`;
    this.logBuffer(p.id).system(msg);
    await this.stop(p.id);
    this.setStatus(p.id, { status: 'error', error: msg });
  }

  // ---------- stop ----------

  stop(id: string): Promise<ProjectView> {
    return this.withLock(id, () => this.doStop(id));
  }

  private async doStop(id: string): Promise<ProjectView> {
    const p = this.mustGet(id);
    const s = this.state(id);
    const record = this.store.runtime[id];
    const port = s.activePort ?? record?.port ?? p.port;
    const log = this.logBuffer(id);
    const wasActive = s.status === 'running' || s.status === 'starting' || Boolean(record);

    s.stopping = true;
    s.generation++;
    log.system('Zastavuji…');

    if (p.kind === 'npm' || p.kind === 'custom') {
      const pid = s.pid ?? record?.pid;
      if (pid) await this.killTree(pid);
      if (s.child) await this.waitExit(s.child, 5000);
      // Osiřelé node procesy, které přežily rodiče: port jsme před startem ověřili jako volný,
      // takže co na něm teď poslouchá, patří tomuto projektu.
      if (wasActive) await this.killPortOwner(id, port);
    } else {
      s.logChild?.kill();
      const env = projectEnv(p, port);
      try {
        if (p.kind === 'compose') {
          const base = await this.composeFiles(p, port);
          const res = await this.runStep(p, [...base, 'down', '--remove-orphans'], env);
          if (res.code !== 0) log.system(dockerError(res.output) ?? `docker compose down skončil s kódem ${res.code}`);
        } else {
          const n = dockerNames(p);
          const res = await this.runStep(p, ['stop', '-t', '5', n.container], env);
          if (res.code !== 0 && !/No such container/i.test(res.output)) {
            log.system(dockerError(res.output) ?? `docker stop skončil s kódem ${res.code}`);
          }
        }
      } catch (err) {
        log.system(`Chyba při zastavení: ${(err as Error).message}`);
      }
    }

    await this.store.setRuntime(id, undefined);
    log.system('Zastaveno.');
    this.setStatus(id, {
      status: 'stopped',
      pid: undefined,
      startedAt: undefined,
      child: undefined,
      logChild: undefined,
      error: undefined,
      portOwner: undefined,
      suggestedPort: undefined,
      adopted: false,
      stopping: false,
      activePort: undefined,
    });
    return this.view(p);
  }

  private async killTree(pid: number) {
    try {
      if (isWindows) {
        await run('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
      } else {
        try {
          process.kill(-pid, 'SIGTERM');
        } catch {
          process.kill(pid, 'SIGTERM');
        }
        await new Promise((r) => setTimeout(r, 3000));
        if (isPidAlive(pid)) {
          try {
            process.kill(-pid, 'SIGKILL');
          } catch {
            process.kill(pid, 'SIGKILL');
          }
        }
      }
    } catch {
      // proces už neexistuje
    }
  }

  private waitExit(child: ChildProcess, timeout: number): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeout);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  private async killPortOwner(id: string, port: number) {
    for (let i = 0; i < 10; i++) {
      const owner = (await listListeners()).get(port);
      if (owner === undefined) return;
      if (owner > 0 && owner !== process.pid) {
        const name = await processName(owner);
        this.logBuffer(id).system(`Na portu ${port} zůstal ${name} (PID ${owner}), ukončuji.`);
        await this.killTree(owner);
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async restart(id: string): Promise<ProjectView> {
    await this.stop(id);
    return this.start(id, { wait: true });
  }

  /** Při mazání projektu */
  async forget(id: string) {
    if (this.isActive(id) || this.store.runtime[id]) await this.stop(id);
    this.states.delete(id);
    this.logs.delete(id);
  }

  // ---------- obnovení po restartu StartSite ----------

  async reconcile() {
    const records = Object.entries(this.store.runtime);
    for (const [id, rec] of records) {
      const p = this.store.projects.find((x) => x.id === id);
      if (!p) {
        await this.store.setRuntime(id, undefined);
        continue;
      }
      try {
        await this.reconcileOne(p, rec);
      } catch (err) {
        this.logBuffer(id).system(`Kontrola stavu selhala: ${(err as Error).message}`);
      }
    }
  }

  private async reconcileOne(p: Project, rec: RuntimeRecord) {
    const log = this.logBuffer(p.id);
    if (rec.kind === 'npm' || rec.kind === 'custom') {
      const listeners = await listListeners();
      const portPid = listeners.get(rec.port);
      let pid: number | undefined;
      if (rec.pid && isPidAlive(rec.pid) && SHELL_NAMES.test(await processName(rec.pid))) pid = rec.pid;
      else if (portPid && portPid > 0 && SHELL_NAMES.test(await processName(portPid))) pid = portPid;

      if (!pid) {
        await this.store.setRuntime(p.id, undefined);
        return;
      }
      log.system(`Převzato z minulé relace (PID ${pid}). Starší výstup není k dispozici.`);
      const responding = await isPortResponding(rec.port);
      this.setStatus(p.id, {
        status: responding ? 'running' : 'starting',
        pid,
        startedAt: rec.startedAt,
        activePort: rec.port,
        adopted: true,
        generation: this.state(p.id).generation + 1,
      });
      await this.store.setRuntime(p.id, { ...rec, pid });
      if (!responding) void this.healthCheck(p, rec.port, this.state(p.id).generation);
      return;
    }

    const running = await this.dockerRunning(p, rec);
    if (!running) {
      await this.store.setRuntime(p.id, undefined);
      return;
    }
    log.system('Kontejner běží z minulé relace, připojuji logy.');
    this.setStatus(p.id, {
      status: 'running',
      startedAt: rec.startedAt,
      activePort: rec.port,
      adopted: true,
      generation: this.state(p.id).generation + 1,
    });
    const env = projectEnv(p, rec.port);
    const args =
      rec.kind === 'compose'
        ? [...(await this.composeFiles(p, rec.port)), 'logs', '-f', '--tail', '50']
        : ['logs', '-f', '--tail', '50', dockerNames(p).container];
    this.followDockerLogs(p, args, env);
  }

  private async dockerRunning(p: Project, rec: RuntimeRecord): Promise<boolean> {
    try {
      if (rec.kind === 'compose') {
        const { stdout } = await run('docker', ['compose', '-p', rec.composeProject ?? dockerNames(p).composeProject, 'ps', '-q', '--status', 'running'], {
          windowsHide: true,
          cwd: p.path,
        });
        return stdout.trim().length > 0;
      }
      const { stdout } = await run('docker', ['inspect', '-f', '{{.State.Running}}', rec.container ?? dockerNames(p).container], {
        windowsHide: true,
      });
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  /** Hlídá převzaté procesy a kontejnery, které nemají vlastní exit událost. */
  startWatchdog() {
    this.watchdog = setInterval(() => void this.tick(), 5000);
    this.watchdog.unref();
  }

  private async tick() {
    for (const p of this.store.projects) {
      const s = this.states.get(p.id);
      if (!s || s.status !== 'running' || s.stopping) continue;
      const rec = this.store.runtime[p.id];
      let alive = true;
      if (p.kind === 'npm' || p.kind === 'custom') {
        if (s.child) continue; // exit událost to vyřeší
        alive = s.pid ? isPidAlive(s.pid) : false;
      } else if (rec) {
        alive = await this.dockerRunning(p, rec);
      }
      if (!alive && this.state(p.id).status === 'running' && !this.state(p.id).stopping) {
        this.logBuffer(p.id).system('Proces už neběží.');
        s.logChild?.kill();
        await this.store.setRuntime(p.id, undefined);
        this.setStatus(p.id, { status: 'stopped', pid: undefined, adopted: false, logChild: undefined });
      }
    }
  }

  /** Při vypnutí StartSite necháme projekty běžet; po startu je reconcile převezme. */
  detachAll() {
    if (this.watchdog) clearInterval(this.watchdog);
    for (const s of this.states.values()) s.logChild?.kill();
  }
}
