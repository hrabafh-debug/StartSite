import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STARTSITE_PORT } from '@startsite/shared';

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, '..', '..');
export const dataDir = resolve(process.env.STARTSITE_DATA || join(repoRoot, 'data'));
export const webDist = join(repoRoot, 'web', 'dist');
export const host = '127.0.0.1';

function parsePortArg(): number | undefined {
  const i = process.argv.indexOf('--port');
  if (i !== -1 && process.argv[i + 1]) return Number(process.argv[i + 1]);
  return undefined;
}

export const port = parsePortArg() ?? Number(process.env.STARTSITE_PORT || DEFAULT_STARTSITE_PORT);
export const isWindows = process.platform === 'win32';
