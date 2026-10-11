// JSON úložiště s atomickým zápisem (temp soubor + rename).
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Project, ProjectKind } from '@startsite/shared';
import { dataDir } from './config.js';

const projectsFile = join(dataDir, 'projects.json');
const runtimeFile = join(dataDir, 'runtime.json');

/** Co potřebujeme vědět po restartu StartSite, abychom našli osiřelé procesy a kontejnery. */
export interface RuntimeRecord {
  kind: ProjectKind;
  port: number;
  startedAt: string;
  pid?: number;
  /** Docker kontejner (dockerfile) */
  container?: string;
  /** compose projekt (-p) */
  composeProject?: string;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Zápisy řadíme za sebe, aby se dva rename nepřebíjely. */
function atomicWrite(file: string, data: unknown): Promise<void> {
  const run = async () => {
    await mkdir(dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    // Na Windows může rename selhat, když soubor zrovna čte antivir nebo editor.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt < 5 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
          await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          continue;
        }
        await rm(tmp, { force: true });
        throw err;
      }
    }
  };
  const next = writeChain.then(run, run);
  writeChain = next.catch(() => undefined);
  return next;
}

export class Store {
  projects: Project[] = [];
  runtime: Record<string, RuntimeRecord> = {};

  async load() {
    const data = await readJson<{ version: number; projects: Project[] }>(projectsFile, { version: 1, projects: [] });
    this.projects = data.projects ?? [];
    this.runtime = await readJson<Record<string, RuntimeRecord>>(runtimeFile, {});
  }

  saveProjects() {
    return atomicWrite(projectsFile, { version: 1, projects: this.projects });
  }

  saveRuntime() {
    return atomicWrite(runtimeFile, this.runtime);
  }

  /** Najde projekt podle ID nebo názvu, bez ohledu na velikost písmen. */
  find(ref: string): Project | undefined {
    const needle = ref.trim().toLowerCase();
    return (
      this.projects.find((p) => p.id.toLowerCase() === needle) ??
      this.projects.find((p) => p.name.toLowerCase() === needle)
    );
  }

  async setRuntime(id: string, record: RuntimeRecord | undefined) {
    if (record) this.runtime[id] = record;
    else delete this.runtime[id];
    await this.saveRuntime();
  }
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'projekt';
}
