// Jednoduchý statický server pro projekty typu "static" (HTML, CSS, JS bez buildu).
// Spouští ho process-manager jako samostatný proces: node static-server.js <složka> <port>
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? process.env.PORT ?? 8000);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
};

function resolvePath(urlPath: string): string | undefined {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const full = normalize(join(root, decoded));
  // Nic mimo složku projektu
  if (full !== root && !full.startsWith(root + sep)) return undefined;
  if (existsSync(full) && statSync(full).isDirectory()) {
    const index = join(full, 'index.html');
    return existsSync(index) ? index : undefined;
  }
  if (existsSync(full)) return full;
  // /kontakt -> /kontakt.html
  if (existsSync(full + '.html')) return full + '.html';
  return undefined;
}

const server = createServer((req, res) => {
  let file: string | undefined;
  try {
    file = resolvePath(req.url ?? '/');
  } catch {
    file = undefined;
  }
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
    console.log(`404 ${req.url}`);
    return;
  }
  const size = statSync(file).size;
  const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  // Rozsahy kvůli videím, prohlížeč je chce přehrávat po částech
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  }
  console.log(`${res.statusCode} ${req.url}`);
});

server.listen(port, '127.0.0.1', () => console.log(`Statický server: http://localhost:${port} (${root})`));
