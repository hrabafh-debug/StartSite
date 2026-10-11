// Rozpozná typ projektu podle souborů ve složce.
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { DetectResult, Framework } from '@startsite/shared';

export const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml'];
const SCRIPT_PREFERENCE = ['dev', 'start', 'serve', 'preview'];

export function findComposeFile(dir: string): string | undefined {
  return COMPOSE_FILES.find((f) => existsSync(join(dir, f)));
}

export function detectFramework(pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }): Framework {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next) return 'next';
  if (deps.astro) return 'astro';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.vite) return 'vite';
  return 'other';
}

/** Port uvnitř kontejneru z compose zápisu: "8080:80", "127.0.0.1:8080:80/tcp", "80", {target: 80}. */
function containerPortOf(entry: unknown): number | undefined {
  if (typeof entry === 'number') return entry;
  if (typeof entry === 'string') {
    const last = entry.split('/')[0].split(':').pop();
    const n = Number(last?.split('-')[0]);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (entry && typeof entry === 'object' && 'target' in entry) {
    const n = Number((entry as { target: unknown }).target);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}

interface ComposeService {
  ports?: unknown[];
  expose?: unknown[];
  build?: unknown;
}

export async function readComposeServices(dir: string, file: string) {
  const doc = parseYaml(await readFile(join(dir, file), 'utf8')) as { services?: Record<string, ComposeService> } | null;
  const services = Object.entries(doc?.services ?? {}).map(([name, svc]) => ({
    name,
    containerPort: containerPortOf(svc?.ports?.[0]) ?? containerPortOf(svc?.expose?.[0]),
    hasPorts: Boolean(svc?.ports?.length),
  }));
  return services;
}

export async function readDockerfileExpose(dir: string): Promise<number | undefined> {
  try {
    const text = await readFile(join(dir, 'Dockerfile'), 'utf8');
    const m = text.match(/^\s*EXPOSE\s+(\d+)/im);
    return m ? Number(m[1]) : undefined;
  } catch {
    return undefined;
  }
}

export async function readPackageJson(dir: string) {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
  } catch {
    return undefined;
  }
}

export async function detectProject(rawPath: string): Promise<DetectResult> {
  const path = resolve(rawPath.trim().replace(/^"(.*)"$/, '$1'));
  const result: DetectResult = {
    path,
    exists: existsSync(path) && statSync(path).isDirectory(),
    name: basename(path),
    kind: 'custom',
    scripts: {},
    services: [],
  };
  if (!result.exists) return result;

  const pkg = await readPackageJson(path);
  const composeFile = findComposeFile(path);
  const hasDockerfile = existsSync(join(path, 'Dockerfile'));

  if (composeFile) {
    const services = await readComposeServices(path, composeFile);
    result.composeFile = composeFile;
    result.services = services.map(({ name, containerPort }) => ({ name, containerPort }));
    const main = services.find((s) => s.hasPorts) ?? services.find((s) => s.containerPort) ?? services[0];
    result.service = main?.name;
    result.containerPort = main?.containerPort;
  } else if (hasDockerfile) {
    result.containerPort = await readDockerfileExpose(path);
  }

  if (pkg) {
    result.kind = 'npm';
    result.name = pkg.name?.replace(/^@[^/]+\//, '') || result.name;
    result.scripts = pkg.scripts ?? {};
    result.defaultScript = SCRIPT_PREFERENCE.find((s) => s in result.scripts) ?? Object.keys(result.scripts)[0];
    result.framework = detectFramework(pkg);
  } else if (composeFile) {
    result.kind = 'compose';
  } else if (hasDockerfile) {
    result.kind = 'dockerfile';
  }
  return result;
}
