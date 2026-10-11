import { ArrowClockwise, ArrowSquareOut, Check, Copy, MagnifyingGlass, PencilSimple, Play, Stop, Trash, Warning } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState, type ReactNode } from 'react';
import type { LogLine, PortCheck, ProjectView } from '@startsite/shared';
import { api, type Action } from '../api';
import { isActive } from './ProjectList';
import { LogView } from './LogView';
import { Button, cx, Input, Kbd, KindBadge, StatusLabel } from './ui';

interface Props {
  project: ProjectView;
  logs: LogLine[] | undefined;
  pending?: Action;
  actionError?: string;
  onRun: (action: Action, port?: number) => void;
  onEdit: () => void;
  onDelete: () => Promise<void>;
  onUpdated: (p: ProjectView) => void;
}

export function ProjectDetail({ project: p, logs, pending, actionError, onRun, onEdit, onDelete, onUpdated }: Props) {
  const active = isActive(p);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setConfirmDelete(false), [p.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {/* Hlavička */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <div className="flex items-center gap-2.5">
            <h2 className="truncate text-xl font-semibold tracking-tight">{p.name}</h2>
            <KindBadge kind={p.kind} />
          </div>
          <div className="mt-1">
            <StatusLabel status={p.runtime.status} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={active ? 'stop' : 'run'}
            loading={pending === 'start' || pending === 'stop'}
            onClick={() => onRun(active ? 'stop' : 'start')}
            icon={active ? <Stop className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
            title="Zkratka S"
          >
            {active ? 'Zastavit' : 'Spustit'}
            <span className="hidden sm:inline-flex">
              <Kbd>S</Kbd>
            </span>
          </Button>
          {active && (
            <Button
              loading={pending === 'restart'}
              disabled={Boolean(pending)}
              onClick={() => onRun('restart')}
              icon={<ArrowClockwise className="size-3.5" weight="bold" />}
            >
              Restart
            </Button>
          )}
          <Button onClick={onEdit} icon={<PencilSimple className="size-3.5" />}>
            Upravit
          </Button>
          {confirmDelete ? (
            <span className="flex items-center gap-1.5">
              <Button
                variant="danger"
                loading={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await onDelete();
                  } finally {
                    setDeleting(false);
                  }
                }}
              >
                Smazat záznam
              </Button>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Ne
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="icon" aria-label="Smazat projekt" title="Smazat (soubory zůstanou)" onClick={() => setConfirmDelete(true)}>
              <Trash className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(p.runtime.status === 'error' || actionError) && (
          <motion.div
            key="err"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            className="overflow-hidden"
          >
            <ErrorBlock project={p} message={actionError ?? p.runtime.error} onRun={onRun} />
          </motion.div>
        )}
      </AnimatePresence>

      <LinkBar project={p} />

      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 border-y border-zinc-200 py-4 text-sm md:grid-cols-2 dark:border-zinc-800">
        <PortEditor project={p} onUpdated={onUpdated} />
        <Item label="Proces">
          {p.runtime.pid ? (
            <span className="font-mono text-[13px]">PID {p.runtime.pid}</span>
          ) : (
            <span className="text-zinc-500">{p.kind === 'npm' || p.kind === 'custom' ? 'Neběží' : 'Kontejner v Dockeru'}</span>
          )}
        </Item>
        <Item label="Příkaz" wide>
          <code className="block break-all font-mono text-[13px] text-zinc-800 dark:text-zinc-200">{p.resolvedCommand}</code>
        </Item>
        <Item label="Složka" wide>
          <code className="block break-all font-mono text-[13px] text-zinc-600 dark:text-zinc-400">{p.path}</code>
        </Item>
        <Item label="Proměnné prostředí" wide>
          {Object.keys(p.env).length === 0 ? (
            <span className="text-zinc-500">
              Jen <code className="font-mono text-[13px]">PORT={p.port}</code>
            </span>
          ) : (
            <ul className="space-y-0.5 font-mono text-[13px]">
              {Object.entries(p.env).map(([k, v]) => (
                <li key={k} className="break-all">
                  <span className="text-zinc-500">{k}=</span>
                  {v}
                </li>
              ))}
            </ul>
          )}
        </Item>
      </dl>

      <LogView
        lines={logs}
        onClear={() => {
          void api.clearLogs(p.id);
        }}
      />
    </div>
  );
}

function Item({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cx('min-w-0', wide && 'md:col-span-2')}>
      <dt className="mb-1 text-xs text-zinc-500">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function ErrorBlock({ project: p, message, onRun }: { project: ProjectView; message?: string; onRun: Props['onRun'] }) {
  const owner = p.runtime.portOwner;
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/70 px-4 py-3 dark:border-red-900/50 dark:bg-red-950/20">
      <div className="flex gap-3">
        <Warning className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" weight="bold" />
        <div className="min-w-0 flex-1 space-y-2">
          {owner ? (
            <p className="text-sm text-red-800 dark:text-red-200">
              Port <span className="font-mono">{p.port}</span> je obsazený. Drží ho <span className="font-mono">{owner.name}</span> s PID{' '}
              <span className="font-mono">{owner.pid}</span>.
            </p>
          ) : (
            <p className="break-words text-sm text-red-800 dark:text-red-200">{message}</p>
          )}
          {p.runtime.suggestedPort && (
            <Button size="sm" variant="secondary" onClick={() => onRun('start', p.runtime.suggestedPort)} icon={<Play className="size-3" weight="fill" />}>
              Spustit na <span className="font-mono">{p.runtime.suggestedPort}</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinkBar({ project: p }: { project: ProjectView }) {
  const [copied, setCopied] = useState(false);
  const running = p.runtime.status === 'running';
  const starting = p.runtime.status === 'starting';

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 transition-colors',
        running
          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/50 dark:bg-emerald-950/20'
          : 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40',
      )}
    >
      <div className="min-w-0 flex-1">
        {running ? (
          <a
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[15px] text-emerald-800 underline-offset-4 hover:underline dark:text-emerald-300"
          >
            {p.url}
          </a>
        ) : (
          <span className="font-mono text-[15px] text-zinc-400 dark:text-zinc-600">{p.url}</span>
        )}
        <p className="mt-0.5 text-xs text-zinc-500">
          {running ? 'Port odpovídá.' : starting ? 'Čekám, až port odpoví.' : 'Odkaz bude aktivní, až projekt poběží.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={running ? 'primary' : 'secondary'}
          disabled={!running}
          onClick={() => window.open(p.url, '_blank', 'noopener')}
          icon={<ArrowSquareOut className="size-3.5" weight="bold" />}
        >
          Otevřít
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(p.url);
            setCopied(true);
          }}
          icon={copied ? <Check className="size-3.5 text-emerald-600" weight="bold" /> : <Copy className="size-3.5" />}
        >
          {copied ? 'Zkopírováno' : 'Kopírovat'}
        </Button>
      </div>
    </div>
  );
}

function PortEditor({ project: p, onUpdated }: { project: ProjectView; onUpdated: (p: ProjectView) => void }) {
  const [value, setValue] = useState(String(p.port));
  const [check, setCheck] = useState<PortCheck | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const port = Number(value);
  const valid = Number.isInteger(port) && port > 0 && port < 65536;
  const dirty = valid && port !== p.port;

  useEffect(() => {
    setValue(String(p.port));
    setError(null);
  }, [p.id, p.port]);

  // Živá kontrola, jestli nový port někdo nedrží
  useEffect(() => {
    setCheck(null);
    if (!dirty) return;
    const t = setTimeout(() => {
      api.checkPort(port).then(setCheck, () => undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [port, dirty]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      onUpdated(await api.update(p.id, { port }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-w-0">
      <label htmlFor="port-input" className="mb-1 block text-xs text-zinc-500">
        Port
      </label>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty) void save();
        }}
      >
        <Input
          id="port-input"
          mono
          inputMode="numeric"
          value={value}
          invalid={!valid}
          onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
          className="h-8 max-w-24"
        />
        {dirty ? (
          <Button size="sm" variant="primary" type="submit" loading={saving}>
            Uložit
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            icon={<MagnifyingGlass className="size-3.5" />}
            onClick={async () => {
              try {
                const { port: free } = await api.freePort(p.port + 1, p.id);
                setValue(String(free));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            Najít volný
          </Button>
        )}
      </form>
      <p className="mt-1 min-h-4 text-xs">
        {error ? (
          <span className="text-red-600 dark:text-red-400">{error}</span>
        ) : dirty && check ? (
          check.free ? (
            <span className="text-zinc-500">
              Volný.{isActive(p) ? ' Projeví se po restartu.' : ''}
              {check.project ? ` V konfiguraci ho má ${check.project}.` : ''}
            </span>
          ) : (
            <span className="text-red-600 dark:text-red-400">
              Drží ho <span className="font-mono">{check.owner?.name}</span> (PID <span className="font-mono">{check.owner?.pid}</span>)
            </span>
          )
        ) : null}
      </p>
    </div>
  );
}
