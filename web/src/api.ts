import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApiError,
  DetectResult,
  LogLine,
  PortCheck,
  ProjectInput,
  ProjectPatch,
  ProjectView,
  ServerEvent,
} from '@startsite/shared';

export class RequestError extends Error {
  constructor(public body: ApiError) {
    super(body.message || body.error);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = { error: 'invalid_response', message: text.slice(0, 200) };
  }
  if (!res.ok) throw new RequestError((data as ApiError) ?? { error: 'http', message: `HTTP ${res.status}` });
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  list: () => request<ProjectView[]>('GET', '/api/projects'),
  add: (input: ProjectInput) => request<ProjectView>('POST', '/api/projects', input),
  update: (id: string, patch: ProjectPatch) => request<ProjectView>('PATCH', `/api/projects/${enc(id)}`, patch),
  remove: (id: string) => request<{ removed: ProjectView }>('DELETE', `/api/projects/${enc(id)}`),
  start: (id: string, port?: number) => request<ProjectView>('POST', `/api/projects/${enc(id)}/start`, port ? { port } : {}),
  stop: (id: string) => request<ProjectView>('POST', `/api/projects/${enc(id)}/stop`, {}),
  restart: (id: string) => request<ProjectView>('POST', `/api/projects/${enc(id)}/restart`, {}),
  logs: (id: string) => request<{ lines: LogLine[] }>('GET', `/api/projects/${enc(id)}/logs?limit=2000`),
  clearLogs: (id: string) => request<{ ok: true }>('DELETE', `/api/projects/${enc(id)}/logs`),
  detect: (path: string) => request<DetectResult>('POST', '/api/detect', { path }),
  freePort: (start?: number, exclude?: string) =>
    request<{ port: number }>(
      'GET',
      `/api/ports/free?${new URLSearchParams({ ...(start ? { start: String(start) } : {}), ...(exclude ? { exclude } : {}) })}`,
    ),
  checkPort: (port: number) => request<PortCheck>('GET', `/api/ports/${port}`),
};

export type Action = 'start' | 'stop' | 'restart';
const MAX_LINES = 2000;

/** Stav celé aplikace: projekty, logy a živé události ze SSE. */
export function useStartSite() {
  const [projects, setProjects] = useState<ProjectView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, LogLine[]>>({});
  const [pending, setPending] = useState<Record<string, Action | undefined>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | undefined>>({});
  const [connected, setConnected] = useState(true);
  const loadedLogs = useRef(new Set<string>());
  const queue = useRef<{ id: string; line: LogLine }[]>([]);

  const refresh = useCallback(async () => {
    try {
      setProjects(await api.list());
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message || 'Backend neodpovídá');
    }
  }, []);

  const upsert = useCallback((p: ProjectView) => {
    setProjects((list) => {
      if (!list) return [p];
      const i = list.findIndex((x) => x.id === p.id);
      if (i === -1) return [...list, p];
      const next = list.slice();
      next[i] = p;
      return next;
    });
  }, []);

  useEffect(() => {
    void refresh();
    const es = new EventSource('/api/events');
    let hadError = false;
    es.onopen = () => {
      setConnected(true);
      if (hadError) {
        // Po výpadku spojení načteme stav znovu, logy se dotáhnou při dalším výběru
        loadedLogs.current.clear();
        setLogs({});
        void refresh();
      }
    };
    es.onerror = () => {
      hadError = true;
      setConnected(false);
    };
    es.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as ServerEvent;
      switch (event.type) {
        case 'project':
          upsert(event.project);
          break;
        case 'removed':
          setProjects((list) => list?.filter((p) => p.id !== event.id) ?? list);
          break;
        case 'log':
          if (loadedLogs.current.has(event.id)) queue.current.push({ id: event.id, line: event.line });
          break;
        case 'logs-cleared':
          setLogs((l) => ({ ...l, [event.id]: [] }));
          break;
      }
    };
    // Řádky logů skládáme po dávkách, ať rychlý výstup nezahltí render
    const flush = setInterval(() => {
      if (!queue.current.length) return;
      const batch = queue.current;
      queue.current = [];
      setLogs((prev) => {
        const next = { ...prev };
        const touched = new Set<string>();
        for (const { id, line } of batch) {
          if (!touched.has(id)) {
            next[id] = (prev[id] ?? []).slice();
            touched.add(id);
          }
          const arr = next[id];
          if (arr.length && arr[arr.length - 1].seq >= line.seq) continue;
          arr.push(line);
        }
        for (const id of touched) {
          if (next[id].length > MAX_LINES) next[id] = next[id].slice(-MAX_LINES);
        }
        return next;
      });
    }, 100);
    return () => {
      es.close();
      clearInterval(flush);
    };
  }, [refresh, upsert]);

  const ensureLogs = useCallback(async (id: string) => {
    if (loadedLogs.current.has(id)) return;
    loadedLogs.current.add(id);
    try {
      const { lines } = await api.logs(id);
      setLogs((prev) => {
        // Spojí načtenou historii s řádky, které mezitím přišly živě
        const live = (prev[id] ?? []).filter((l) => l.seq > (lines.at(-1)?.seq ?? 0));
        return { ...prev, [id]: [...lines, ...live] };
      });
    } catch {
      loadedLogs.current.delete(id);
    }
  }, []);

  const run = useCallback(
    async (id: string, action: Action, port?: number) => {
      setPending((p) => ({ ...p, [id]: action }));
      setActionErrors((e) => ({ ...e, [id]: undefined }));
      try {
        const view =
          action === 'start' ? await api.start(id, port) : action === 'stop' ? await api.stop(id) : await api.restart(id);
        upsert(view);
      } catch (err) {
        // Obsazený port server zapíše přímo do stavu projektu, ostatní chyby ukážeme inline
        if (!(err instanceof RequestError && err.body.error === 'port_in_use')) {
          setActionErrors((e) => ({ ...e, [id]: (err as Error).message }));
        }
      } finally {
        setPending((p) => ({ ...p, [id]: undefined }));
      }
    },
    [upsert],
  );

  return { projects, loadError, logs, pending, actionErrors, connected, refresh, upsert, ensureLogs, run, setActionErrors };
}

export type StartSiteState = ReturnType<typeof useStartSite>;
