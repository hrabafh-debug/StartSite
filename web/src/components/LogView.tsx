import { ArrowDown, Trash, WarningCircle } from '@phosphor-icons/react';
import { AnsiUp } from 'ansi_up';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogLine } from '@startsite/shared';
import { Button, cx, Skeleton } from './ui';

const ansi = new AnsiUp();
ansi.use_classes = true;

const time = new Intl.DateTimeFormat('cs-CZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const Row = memo(function Row({ line }: { line: LogLine }) {
  // ansi_up escapuje HTML, takže výstup procesu nemůže vložit vlastní značky
  const html = useMemo(() => ansi.ansi_to_html(line.text) || '&nbsp;', [line.text]);
  return (
    <div
      className={cx(
        'flex gap-3 px-3 py-px',
        line.error && 'border-l-2 border-red-500 bg-red-50 pl-2.5 text-red-800 dark:bg-red-950/30 dark:text-red-300',
        line.stream === 'system' && 'text-zinc-500 dark:text-zinc-500',
      )}
    >
      <span className="shrink-0 select-none text-zinc-400 tabular-nums dark:text-zinc-600">{time.format(line.ts)}</span>
      <span className="min-w-0 whitespace-pre-wrap break-all" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
});

interface Props {
  lines: LogLine[] | undefined;
  onClear: () => void;
}

export function LogView({ lines, onClear }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  const [onlyErrors, setOnlyErrors] = useState(false);
  const errorCount = useMemo(() => lines?.filter((l) => l.error).length ?? 0, [lines]);
  const shown = useMemo(() => (onlyErrors ? (lines ?? []).filter((l) => l.error) : (lines ?? [])), [lines, onlyErrors]);

  useLayoutEffect(() => {
    if (stick && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, stick]);

  // Když se panel zmenší (třeba se objeví chybová hláška), zůstaneme dole
  useEffect(() => {
    const el = box.current;
    if (!el || !stick) return;
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stick]);

  useEffect(() => {
    if (!errorCount) setOnlyErrors(false);
  }, [errorCount]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <header className="flex items-center gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <h3 className="text-[13px] font-medium">Logy</h3>
        <span className="font-mono text-[11px] text-zinc-500 tabular-nums">{lines?.length ?? 0} řádků</span>
        <div className="ml-auto flex items-center gap-1">
          {errorCount > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setOnlyErrors((v) => !v)}
              aria-pressed={onlyErrors}
              className={cx(onlyErrors && 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300')}
              icon={<WarningCircle className="size-3.5" weight="bold" />}
            >
              Chyby <span className="font-mono tabular-nums">{errorCount}</span>
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClear} icon={<Trash className="size-3.5" />} disabled={!lines?.length}>
            Vymazat
          </Button>
        </div>
      </header>
      <div className="relative min-h-0 flex-1">
        <div
          ref={box}
          onScroll={onScroll}
          className="log absolute inset-0 overflow-y-auto py-2 font-mono text-[12px] leading-[1.55] text-zinc-800 dark:text-zinc-300"
          role="log"
          aria-live="off"
        >
          {!lines ? (
            <div className="space-y-2 px-3 py-1">
              {['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'].map((w) => (
                <Skeleton key={w} className={cx('h-3', w)} />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <p className="px-3 py-1 font-sans text-[13px] text-zinc-500">Zatím žádný výstup. Spusť projekt a logy se objeví tady.</p>
          ) : (
            shown.map((l) => <Row key={l.seq} line={l} />)
          )}
        </div>
        {!stick && shown.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-3 right-4 shadow-sm"
            onClick={() => setStick(true)}
            icon={<ArrowDown className="size-3.5" weight="bold" />}
          >
            Na konec
          </Button>
        )}
      </div>
    </section>
  );
}
