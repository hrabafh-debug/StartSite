#!/usr/bin/env node
// Vstupní bod pro `claude mcp add startsite -- node <cesta>/mcp/index.js`.
// Zkompilovaný server je v dist/ (npm run build).
import { existsSync } from 'node:fs';

const entry = new URL('./dist/index.js', import.meta.url);
if (!existsSync(entry)) {
  console.error('StartSite MCP není sestavený. Spusť "npm install && npm run build" v kořeni repa.');
  process.exit(1);
}
await import(entry.href);
