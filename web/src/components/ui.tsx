import { CircleNotch } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { forwardRef } from 'react';
import type { ProjectKind, ProjectStatus } from '@startsite/shared';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  running: 'Běží',
  starting: 'Startuje',
  stopped: 'Zastaveno',
  error: 'Chyba',
};

const DOT_COLOR: Record<ProjectStatus, string> = {
  running: 'text-emerald-500',
  starting: 'text-amber-500',
  stopped: 'text-zinc-300 dark:text-zinc-600',
  error: 'text-red-500',
};

export function StatusDot({ status, className }: { status: ProjectStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        'relative inline-block size-2 shrink-0 rounded-full bg-current',
        DOT_COLOR[status],
        status === 'running' && 'dot-pulse',
        status === 'starting' && 'animate-pulse',
        className,
      )}
    />
  );
}

export function StatusLabel({ status }: { status: ProjectStatus }) {
  return (
    <span className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export const KIND_LABEL: Record<ProjectKind, string> = {
  npm: 'npm',
  compose: 'compose',
  dockerfile: 'docker',
  dotnet: '.net',
  static: 'statický',
  custom: 'příkaz',
};

export function KindBadge({ kind }: { kind: ProjectKind }) {
  return (
    <span className="rounded border border-zinc-200 px-1.5 py-px font-mono text-[11px] leading-4 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      {KIND_LABEL[kind]}
    </span>
  );
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'run' | 'stop';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]',
  secondary:
    'border border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800/70',
  ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100',
  danger:
    'border border-zinc-200 bg-white text-red-600 hover:border-red-200 hover:bg-red-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:border-red-900/60 dark:hover:bg-red-950/40',
  run: 'bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400 shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]',
  stop: 'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'icon';
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-md font-medium transition-[background-color,border-color,color,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'md' && 'h-8 px-3 text-sm',
        size === 'icon' && 'size-8',
        VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <CircleNotch className="size-4 animate-spin" weight="bold" /> : icon}
      {children}
    </button>
  );
});

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean; invalid?: boolean }>(
  function Input({ className, mono, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cx(
          'h-9 w-full min-w-0 rounded-md border bg-white px-3 text-sm text-zinc-900 placeholder:text-zinc-400 transition-colors',
          'focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/5 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-zinc-600 dark:focus:ring-white/5',
          invalid ? 'border-red-300 dark:border-red-900' : 'border-zinc-200 dark:border-zinc-800',
          mono && 'font-mono text-[13px]',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 font-mono text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
      {children}
    </kbd>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}
