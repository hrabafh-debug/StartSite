import { ArrowRight, Desktop, MagnifyingGlass, Moon, Plus, Sun, WifiSlash } from '@phosphor-icons/react';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import type { ProjectView } from '@startsite/shared';
import { api, useStartSite } from './api';
import { ProjectDetail } from './components/ProjectDetail';
import { ProjectForm } from './components/ProjectForm';
import { isActive, ProjectList, ProjectListSkeleton } from './components/ProjectList';
import { Button, Input, Kbd, Skeleton } from './components/ui';

type Theme = 'system' | 'light' | 'dark';
type FormState = { mode: 'add'; initialPath?: string } | { mode: 'edit'; id: string } | null;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // úložiště není dostupné, nevadí
  }
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => (read('startsite-theme') as Theme) || 'system');
  useEffect(() => {
    write('startsite-theme', theme);
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => document.documentElement.classList.toggle('dark', theme === 'dark' || (theme === 'system' && mq.matches));
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return [theme, setTheme] as const;
}

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<Theme, string> = { system: 'podle systému', light: 'světlý', dark: 'tmavý' };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
}

export function App() {
  const s = useStartSite();
  const [theme, setTheme] = useTheme();
  const [selectedId, setSelectedId] = useState<string | undefined>(() => read('startsite-selected') ?? undefined);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<FormState>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const { ensureLogs, run, pending } = s;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = s.projects ?? [];
    if (!q) return list;
    return list.filter((p) => [p.name, p.id, p.path, String(p.port), p.kind].some((v) => v.toLowerCase().includes(q)));
  }, [s.projects, query]);

  const selected = s.projects?.find((p) => p.id === selectedId) ?? filtered[0];
  const selectedKey = selected?.id;

  useEffect(() => {
    if (!selectedKey) return;
    write('startsite-selected', selectedKey);
    void ensureLogs(selectedKey);
  }, [selectedKey, ensureLogs]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    // Na mobilu je detail pod seznamem
    if (window.matchMedia('(max-width: 767px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }, []);

  const toggle = useCallback((p: ProjectView) => void run(p.id, isActive(p) ? 'stop' : 'start'), [run]);

  // Fokus nesmí zůstat v mizejícím formuláři, jinak by zkratky po zavření nereagovaly
  const closeForm = useCallback(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    setForm(null);
  }, []);

  // Klávesové zkratky: / hledání, N nový projekt, S start/stop, šipky výběr
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (form || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setForm({ mode: 'add' });
      } else if ((e.key === 's' || e.key === 'S') && selected) {
        e.preventDefault();
        if (!pending[selected.id]) toggle(selected);
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filtered.length) {
        e.preventDefault();
        const i = filtered.findIndex((p) => p.id === selected?.id);
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setSelectedId(filtered[Math.min(filtered.length - 1, Math.max(0, i + dir))].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [form, selected, filtered, toggle, pending]);

  const runningCount = s.projects?.filter((p) => p.runtime.status === 'running').length ?? 0;
  const editProject = form?.mode === 'edit' ? s.projects?.find((p) => p.id === form.id) : undefined;
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Desktop;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-zinc-50/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-3 px-4 md:px-6">
          <div className="flex shrink-0 items-center gap-2.5">
            <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
              <rect width="32" height="32" rx="7" className="fill-zinc-900 dark:fill-zinc-100" />
              <path d="M12 9.5v13l10-6.5z" className="fill-emerald-400 dark:fill-emerald-600" />
            </svg>
            <span className="text-[15px] font-semibold tracking-tight">StartSite</span>
            {s.projects && s.projects.length > 0 && (
              <span className="hidden font-mono text-xs text-zinc-500 sm:inline">
                {runningCount}/{s.projects.length} běží
              </span>
            )}
          </div>

          <div className="relative ml-auto w-full max-w-xs">
            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
            <Input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Hledat projekt"
              aria-label="Hledat projekt"
              className="h-8 pl-8 pr-8"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 sm:block">
              <Kbd>/</Kbd>
            </span>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setTheme(THEME_NEXT[theme])}
            title={`Motiv: ${THEME_LABEL[theme]}`}
            aria-label={`Motiv: ${THEME_LABEL[theme]}`}
          >
            <ThemeIcon className="size-4" />
          </Button>
          <Button
            variant="primary"
            onClick={() => setForm({ mode: 'add' })}
            icon={<Plus className="size-3.5" weight="bold" />}
            title="Nový projekt (N)"
            aria-label="Nový projekt"
          >
            <span className="hidden sm:inline">Nový projekt</span>
            <span className="hidden sm:inline-flex">
              <Kbd>N</Kbd>
            </span>
          </Button>
        </div>
        {!s.connected && (
          <div className="flex items-center justify-center gap-2 border-t border-zinc-200 bg-zinc-100 px-4 py-1.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <WifiSlash className="size-3.5" />
            Spojení s backendem přerušeno, zkouším znovu.
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col">
        {s.loadError && !s.projects ? (
          <LoadError message={s.loadError} onRetry={() => void s.refresh()} />
        ) : s.projects === null ? (
          <Layout list={<ProjectListSkeleton />} detail={<DetailSkeleton />} />
        ) : s.projects.length === 0 ? (
          <EmptyState onContinue={(path) => setForm({ mode: 'add', initialPath: path })} />
        ) : (
          <Layout
            detailRef={detailRef}
            list={
              filtered.length ? (
                <ProjectList projects={filtered} selectedId={selected?.id} pending={pending} onSelect={select} onToggle={toggle} />
              ) : (
                <p className="px-4 py-6 text-sm text-zinc-500">
                  Nic neodpovídá <span className="font-mono">{query}</span>.
                </p>
              )
            }
            detail={
              selected ? (
                <ProjectDetail
                  key={selected.id}
                  project={selected}
                  logs={s.logs[selected.id]}
                  pending={pending[selected.id]}
                  actionError={s.actionErrors[selected.id]}
                  onRun={(action, port) => void run(selected.id, action, port)}
                  onEdit={() => setForm({ mode: 'edit', id: selected.id })}
                  onUpdated={s.upsert}
                  onDelete={async () => {
                    try {
                      await api.remove(selected.id);
                    } catch (err) {
                      s.setActionErrors((e) => ({ ...e, [selected.id]: (err as Error).message }));
                    }
                  }}
                />
              ) : null
            }
          />
        )}
      </main>

      <AnimatePresence>
        {form && (
          <ProjectForm
            key={form.mode === 'edit' ? form.id : 'new'}
            project={editProject}
            initialPath={form.mode === 'add' ? form.initialPath : undefined}
            onClose={closeForm}
            onSaved={(p) => {
              s.upsert(p);
              setSelectedId(p.id);
              closeForm();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Layout({ list, detail, detailRef }: { list: ReactNode; detail: ReactNode; detailRef?: Ref<HTMLElement> }) {
  return (
    <div className="grid flex-1 grid-cols-1 md:h-[calc(100dvh-3.5rem)] md:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
      <aside className="border-b border-zinc-200 md:overflow-y-auto md:border-b-0 md:border-r dark:border-zinc-800">
        <h2 className="px-4 pb-2 pt-4 text-xs font-medium uppercase tracking-wider text-zinc-500">Projekty</h2>
        {list}
      </aside>
      <section ref={detailRef} className="flex min-h-0 scroll-mt-14 flex-col px-4 py-5 md:overflow-hidden md:px-8 md:py-6">
        {detail}
      </section>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-1 flex-col gap-5" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
      <Skeleton className="min-h-60 flex-1 rounded-lg" />
    </div>
  );
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="px-4 py-16 md:px-6">
      <div className="max-w-lg rounded-lg border border-red-200 bg-red-50/70 px-5 py-4 dark:border-red-900/50 dark:bg-red-950/20">
        <p className="text-sm font-medium text-red-800 dark:text-red-200">Backend neodpovídá</p>
        <p className="mt-1 font-mono text-xs text-red-700 dark:text-red-300">{message}</p>
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Zkusit znovu
        </Button>
      </div>
    </div>
  );
}

function EmptyState({ onContinue }: { onContinue: (path: string) => void }) {
  const [path, setPath] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <div className="grid flex-1 grid-cols-1 content-start gap-10 px-4 py-14 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:px-6 md:py-24">
      <div className="max-w-xl">
        <p className="font-mono text-xs text-zinc-500">0 projektů</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Přidej první projekt</h1>
        <p className="mt-3 max-w-[52ch] text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
          Vlož cestu ke složce. Typ se pozná podle <span className="font-mono text-[13px]">package.json</span>,{' '}
          <span className="font-mono text-[13px]">docker-compose.yml</span> nebo <span className="font-mono text-[13px]">Dockerfile</span>.
        </p>
        <form
          className="mt-6 flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            onContinue(path.trim());
          }}
        >
          <Input
            ref={ref}
            mono
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="C:\Users\...\muj-web"
            aria-label="Cesta ke složce projektu"
            className="h-10"
          />
          <Button type="submit" variant="primary" className="h-10 px-4" icon={<ArrowRight className="size-4" weight="bold" />}>
            Pokračovat
          </Button>
        </form>
      </div>
      <div className="border-t border-zinc-200 pt-6 text-sm text-zinc-600 md:border-l md:border-t-0 md:pl-8 md:pt-0 dark:border-zinc-800 dark:text-zinc-400">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">Ovládání z Claude</p>
        <p className="mt-2 leading-relaxed">Po registraci MCP serveru může Claude projekty přidávat, spouštět a číst jejich logy.</p>
        <code className="mt-3 block break-all rounded-md border border-zinc-200 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-800 dark:bg-zinc-900">
          claude mcp add startsite -- node &lt;cesta&gt;/mcp/index.js
        </code>
      </div>
    </div>
  );
}
