// HTTP klient pro MCP a CLI. Když backend neběží, spustí ho na pozadí.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ApiError,
  DetectResult,
  LogLine,
  PortCheck,
  ProjectInput,
  ProjectPatch,
  ProjectView,
} from './index.js';
import { DEFAULT_STARTSITE_PORT } from './index.js';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public body: ApiError,
  ) {
    super(body.message || body.error);
  }
}

export interface ClientOptions {
  port?: number;
  /** Spustit backend, když neodpovídá. Výchozí true. */
  autoStart?: boolean;
}

export class StartSiteClient {
  readonly baseUrl: string;
  private ensured = false;

  constructor(private opts: ClientOptions = {}) {
    const port = opts.port ?? Number(process.env.STARTSITE_PORT || DEFAULT_STARTSITE_PORT);
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async isUp(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Ověří, že backend běží, jinak ho spustí jako samostatný proces. */
  async ensureBackend(): Promise<void> {
    if (this.ensured) return;
    if (await this.isUp()) {
      this.ensured = true;
      return;
    }
    if (this.opts.autoStart === false) {
      throw new Error(`Backend StartSite neběží na ${this.baseUrl}`);
    }
    const entry = join(repoRoot, 'server', 'dist', 'index.js');
    if (!existsSync(entry)) {
      throw new Error(`Backend není sestavený (${entry}). Spusť "npm run build" v ${repoRoot}.`);
    }
    const dataDir = join(repoRoot, 'data');
    mkdirSync(dataDir, { recursive: true });
    const log = openSync(join(dataDir, 'server.log'), 'a');
    const port = new URL(this.baseUrl).port;
    const child = spawn(process.execPath, [entry], {
      cwd: repoRoot,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: { ...process.env, STARTSITE_PORT: port },
    });
    child.unref();

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      if (await this.isUp()) {
        this.ensured = true;
        return;
      }
    }
    throw new Error(`Backend se nepodařilo spustit, viz ${join(dataDir, 'server.log')}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureBackend();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new ApiRequestError(res.status, data as ApiError);
    return data as T;
  }

  list() {
    return this.request<ProjectView[]>('GET', '/api/projects');
  }
  get(ref: string) {
    return this.request<ProjectView>('GET', `/api/projects/${encodeURIComponent(ref)}`);
  }
  add(input: ProjectInput) {
    return this.request<ProjectView>('POST', '/api/projects', input);
  }
  update(ref: string, patch: ProjectPatch) {
    return this.request<ProjectView>('PATCH', `/api/projects/${encodeURIComponent(ref)}`, patch);
  }
  remove(ref: string) {
    return this.request<{ removed: ProjectView }>('DELETE', `/api/projects/${encodeURIComponent(ref)}`);
  }
  /** wait: počká, až port odpovídá (nebo start selže) */
  start(ref: string, opts: { port?: number; wait?: boolean } = {}) {
    return this.request<ProjectView>('POST', `/api/projects/${encodeURIComponent(ref)}/start`, opts);
  }
  stop(ref: string) {
    return this.request<ProjectView>('POST', `/api/projects/${encodeURIComponent(ref)}/stop`, {});
  }
  restart(ref: string) {
    return this.request<ProjectView>('POST', `/api/projects/${encodeURIComponent(ref)}/restart`, {});
  }
  /** plain: bez ANSI escape sekvencí */
  logs(ref: string, limit = 100, plain = true) {
    return this.request<{ project: ProjectView; lines: LogLine[] }>(
      'GET',
      `/api/projects/${encodeURIComponent(ref)}/logs?limit=${limit}${plain ? '&plain=1' : ''}`,
    );
  }
  detect(path: string) {
    return this.request<DetectResult>('POST', '/api/detect', { path });
  }
  freePort(start?: number) {
    return this.request<{ port: number }>('GET', `/api/ports/free${start ? `?start=${start}` : ''}`);
  }
  checkPort(port: number) {
    return this.request<PortCheck>('GET', `/api/ports/${port}`);
  }
}
