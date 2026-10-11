// Logy v paměti (kruhový buffer) a sběrnice událostí pro SSE.
import { EventEmitter } from 'node:events';
import { LOG_BUFFER_LINES, type LogLine, type ServerEvent } from '@startsite/shared';

class Bus extends EventEmitter {
  emitEvent(event: ServerEvent) {
    this.emit('event', event);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;
const ERROR_RE = /\b(error|errors?:|err!|failed|failure|fatal|exception|unhandled|panic|EADDRINUSE|ENOENT|EACCES)\b/i;
const NOT_ERROR_RE = /\b(0 errors?|no errors?|without errors?)\b/i;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

export function isErrorLine(text: string): boolean {
  const plain = stripAnsi(text);
  return ERROR_RE.test(plain) && !NOT_ERROR_RE.test(plain);
}

export class LogBuffer {
  private lines: LogLine[] = [];
  private seq = 0;
  private partial: Record<'stdout' | 'stderr', string> = { stdout: '', stderr: '' };

  constructor(private projectId: string) {}

  push(stream: LogLine['stream'], text: string) {
    const line: LogLine = { seq: ++this.seq, ts: Date.now(), stream, text, error: stream !== 'system' && isErrorLine(text) };
    this.lines.push(line);
    if (this.lines.length > LOG_BUFFER_LINES) this.lines.splice(0, this.lines.length - LOG_BUFFER_LINES);
    bus.emitEvent({ type: 'log', id: this.projectId, line });
  }

  system(text: string) {
    this.push('system', text);
  }

  /** Přijme surový chunk ze streamu a rozdělí ho na řádky. */
  write(stream: 'stdout' | 'stderr', chunk: Buffer | string) {
    const data = this.partial[stream] + chunk.toString();
    const parts = data.split(/\r?\n/);
    this.partial[stream] = parts.pop() ?? '';
    for (const part of parts) {
      // Progress bary přepisují řádek přes \r, necháme jen poslední stav.
      const text = part.includes('\r') ? part.slice(part.lastIndexOf('\r') + 1) : part;
      this.push(stream, text);
    }
    // Ochrana proti obřím řádkům bez konce
    if (this.partial[stream].length > 16_000) {
      this.push(stream, this.partial[stream]);
      this.partial[stream] = '';
    }
  }

  flush() {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (this.partial[stream]) {
        this.push(stream, this.partial[stream]);
        this.partial[stream] = '';
      }
    }
  }

  tail(limit = LOG_BUFFER_LINES): LogLine[] {
    return this.lines.slice(-Math.max(1, Math.min(limit, LOG_BUFFER_LINES)));
  }

  clear() {
    this.lines = [];
    bus.emitEvent({ type: 'logs-cleared', id: this.projectId });
  }
}
