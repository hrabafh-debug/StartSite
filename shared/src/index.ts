// Sdílené typy pro server, web, MCP a CLI. Bez importů z Node, aby šly použít i v prohlížeči.

export type ProjectKind = 'npm' | 'compose' | 'dockerfile' | 'custom';
export type Framework = 'vite' | 'astro' | 'sveltekit' | 'next' | 'other';
export type ProjectStatus = 'stopped' | 'starting' | 'running' | 'error';

export interface Project {
  id: string;
  name: string;
  path: string;
  kind: ProjectKind;
  /** npm: název skriptu (dev, start, ...) */
  script?: string;
  /** custom: příkaz pro shell, `{port}` se nahradí portem */
  command?: string;
  framework?: Framework;
  port: number;
  /** Docker: port uvnitř kontejneru */
  containerPort?: number;
  /** compose: služba, na kterou se mapuje port */
  service?: string;
  env: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface PortOwner {
  pid: number;
  name: string;
}

export interface RuntimeInfo {
  status: ProjectStatus;
  pid?: number;
  startedAt?: string;
  error?: string;
  /** Detail k chybě obsazeného portu */
  portOwner?: PortOwner;
  suggestedPort?: number;
}

export interface ProjectView extends Project {
  runtime: RuntimeInfo;
  url: string;
  /** Příkaz tak, jak se reálně spustí */
  resolvedCommand: string;
}

/** Chybějící název a typ doplní server z detekce složky. */
export interface ProjectInput {
  name?: string;
  path: string;
  kind?: ProjectKind;
  script?: string;
  command?: string;
  framework?: Framework;
  port?: number;
  containerPort?: number;
  service?: string;
  env?: Record<string, string>;
}

export type ProjectPatch = Partial<ProjectInput>;

export interface DetectResult {
  path: string;
  exists: boolean;
  name: string;
  kind: ProjectKind;
  scripts: Record<string, string>;
  defaultScript?: string;
  framework?: Framework;
  services: { name: string; containerPort?: number }[];
  service?: string;
  containerPort?: number;
  composeFile?: string;
}

export interface LogLine {
  seq: number;
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
  error: boolean;
}

export interface PortCheck {
  port: number;
  free: boolean;
  owner?: PortOwner;
  /** Projekt StartSite, kterému port patří v konfiguraci */
  project?: string;
}

export type ServerEvent =
  | { type: 'project'; project: ProjectView }
  | { type: 'removed'; id: string }
  | { type: 'log'; id: string; line: LogLine }
  | { type: 'logs-cleared'; id: string };

export interface ApiError {
  error: string;
  message: string;
  port?: number;
  owner?: PortOwner;
  suggestedPort?: number;
}

export const DEFAULT_STARTSITE_PORT = 4500;
export const LOG_BUFFER_LINES = 2000;

export function projectUrl(port: number): string {
  return `http://localhost:${port}`;
}
