import { Play, Stop } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'framer-motion';
import type { ProjectView } from '@startsite/shared';
import type { Action } from '../api';
import { Button, cx, KindBadge, Skeleton, StatusDot } from './ui';

interface Props {
  projects: ProjectView[];
  selectedId?: string;
  pending: Record<string, Action | undefined>;
  onSelect: (id: string) => void;
  onToggle: (p: ProjectView) => void;
}

export function isActive(p: ProjectView) {
  return p.runtime.status === 'running' || p.runtime.status === 'starting';
}

export function ProjectList({ projects, selectedId, pending, onSelect, onToggle }: Props) {
  return (
    <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80" role="listbox" aria-label="Projekty">
      <AnimatePresence initial={false}>
        {projects.map((p) => {
          const active = isActive(p);
          const busy = pending[p.id];
          const selected = p.id === selectedId;
          return (
            <motion.li
              key={p.id}
              layout="position"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(p.id)}
              className={cx(
                'group relative flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors',
                selected ? 'bg-zinc-100 dark:bg-zinc-900' : 'hover:bg-zinc-100/60 dark:hover:bg-zinc-900/50',
              )}
            >
              {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-zinc-900 dark:bg-zinc-100" />}
              <StatusDot status={p.runtime.status} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{p.name}</span>
                  <KindBadge kind={p.kind} />
                </div>
                {p.runtime.status === 'error' ? (
                  <p className="truncate text-xs text-red-600 dark:text-red-400">{p.runtime.error}</p>
                ) : (
                  <p className="truncate font-mono text-[11px] text-zinc-500">{p.path}</p>
                )}
              </div>
              <span
                className={cx(
                  'font-mono text-xs tabular-nums',
                  p.runtime.status === 'running' ? 'text-emerald-700 dark:text-emerald-400' : 'text-zinc-500',
                )}
              >
                :{p.port}
              </span>
              <Button
                size="icon"
                variant={active ? 'stop' : 'secondary'}
                loading={Boolean(busy)}
                aria-label={active ? `Zastavit ${p.name}` : `Spustit ${p.name}`}
                title={active ? 'Zastavit' : 'Spustit'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(p);
                }}
                icon={active ? <Stop className="size-3.5" weight="fill" /> : <Play className="size-3.5" weight="fill" />}
              />
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export function ProjectListSkeleton() {
  return (
    <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800/80" aria-hidden>
      {['w-2/3', 'w-1/2', 'w-3/4', 'w-2/5'].map((w) => (
        <li key={w} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-2 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className={cx('h-3.5', w)} />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
          <Skeleton className="h-3 w-10" />
          <Skeleton className="size-8 rounded-md" />
        </li>
      ))}
    </ul>
  );
}
