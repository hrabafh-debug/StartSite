import { CircleNotch, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import type { DetectResult, Framework, PortCheck, ProjectInput, ProjectKind, ProjectView } from '@startsite/shared';
import { api, RequestError } from '../api';
import { Button, cx, Field, Input, KIND_LABEL } from './ui';

interface Props {
  project?: ProjectView;
  initialPath?: string;
  onClose: () => void;
  onSaved: (p: ProjectView) => void;
}

const KINDS: { kind: ProjectKind; hint: string }[] = [
  { kind: 'npm', hint: 'package.json' },
  { kind: 'compose', hint: 'docker compose' },
  { kind: 'dockerfile', hint: 'Dockerfile' },
  { kind: 'dotnet', hint: 'ASP.NET (.csproj)' },
  { kind: 'static', hint: 'HTML bez buildu' },
  { kind: 'custom', hint: 'vlastní příkaz' },
];

const FRAMEWORKS: { value: Framework; label: string }[] = [
  { value: 'vite', label: 'Vite' },
  { value: 'astro', label: 'Astro' },
  { value: 'sveltekit', label: 'SvelteKit' },
  { value: 'next', label: 'Next.js' },
  { value: 'other', label: 'Jiný (jen PORT)' },
];

type Errors = Partial<Record<'path' | 'name' | 'port' | 'command' | 'script' | 'containerPort' | 'env' | 'form', string>>;

const selectClass =
  'h-9 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900 focus:border-zinc-400 focus:outline-none dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100';

/** Kód chyby z API -> pole formuláře, u kterého se chyba ukáže */
function errorField(code: string): keyof Errors {
  if (code.startsWith('path') || code === 'compose_missing' || code === 'dockerfile_missing') return 'path';
  if (code.startsWith('name')) return 'name';
  if (code === 'invalid_port') return 'port';
  if (code.startsWith('command')) return 'command';
  if (code.startsWith('script')) return 'script';
  if (code === 'invalid_env') return 'env';
  return 'form';
}

export function ProjectForm({ project, initialPath, onClose, onSaved }: Props) {
  const editing = Boolean(project);
  const [path, setPath] = useState(project?.path ?? initialPath ?? '');
  const [detected, setDetected] = useState<DetectResult | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const nameTouched = useRef(editing);
  const [kind, setKind] = useState<ProjectKind>(project?.kind ?? 'npm');
  const [script, setScript] = useState(project?.script ?? '');
  const [framework, setFramework] = useState<Framework>(project?.framework ?? 'other');
  const [command, setCommand] = useState(project?.command ?? '');
  const [port, setPort] = useState(project ? String(project.port) : '');
  const [containerPort, setContainerPort] = useState(project?.containerPort ? String(project.containerPort) : '');
  const [service, setService] = useState(project?.service ?? '');
  const [env, setEnv] = useState<{ k: string; v: string }[]>(Object.entries(project?.env ?? {}).map(([k, v]) => ({ k, v })));
  const [portCheck, setPortCheck] = useState<PortCheck | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const pathRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) pathRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onClose]);

  // Detekce typu projektu podle složky
  const runDetect = async (value: string, applyDefaults: boolean) => {
    if (!value.trim()) return;
    setDetecting(true);
    setErrors((e) => ({ ...e, path: undefined }));
    try {
      const d = await api.detect(value);
      setDetected(d);
      if (!d.exists) {
        setErrors((e) => ({ ...e, path: 'Složka neexistuje' }));
        return;
      }
      if (!applyDefaults) return;
      setPath(d.path);
      setKind(d.kind);
      if (!nameTouched.current) setName(d.name);
      setScript(d.defaultScript ?? '');
      if (d.command) setCommand(d.command);
      setFramework(d.framework ?? 'other');
      setService(d.service ?? '');
      setContainerPort(d.containerPort ? String(d.containerPort) : '');
      if (!port) setPort(String((await api.freePort()).port));
    } catch (err) {
      setErrors((e) => ({ ...e, path: (err as Error).message }));
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    if (path) void runDetect(path, !editing);
    // jen při otevření formuláře
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Živá kontrola portu
  const portNum = Number(port);
  useEffect(() => {
    setPortCheck(null);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) return;
    if (project && portNum === project.port) return;
    const t = setTimeout(() => api.checkPort(portNum).then(setPortCheck, () => undefined), 250);
    return () => clearTimeout(t);
  }, [portNum, project]);

  const submit = async () => {
    const next: Errors = {};
    if (!path.trim()) next.path = 'Zadej cestu ke složce';
    if (!name.trim()) next.name = 'Zadej název';
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) next.port = 'Port musí být 1 až 65535';
    if (kind === 'custom' && !command.trim()) next.command = 'Zadej příkaz';
    if ((kind === 'compose' || kind === 'dockerfile') && !containerPort) next.containerPort = 'Zadej port uvnitř kontejneru';
    const envObj: Record<string, string> = {};
    for (const { k, v } of env) {
      if (!k.trim()) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k.trim())) next.env = `Neplatný název proměnné: ${k}`;
      envObj[k.trim()] = v;
    }
    setErrors(next);
    if (Object.keys(next).length) return;

    const input: ProjectInput = {
      path: path.trim(),
      name: name.trim(),
      kind,
      port: portNum,
      env: envObj,
      ...(kind === 'npm' ? { script, framework } : {}),
      ...(kind === 'custom' ? { command: command.trim() } : {}),
      ...(kind === 'compose' ? { service: service || undefined, containerPort: Number(containerPort) } : {}),
      ...(kind === 'dockerfile' ? { containerPort: Number(containerPort) } : {}),
    };
    setSaving(true);
    try {
      onSaved(project ? await api.update(project.id, input) : await api.add(input));
    } catch (err) {
      const code = err instanceof RequestError ? err.body.error : 'form';
      setErrors({ [errorField(code)]: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const scripts = Object.entries(detected?.scripts ?? {});
  const services = detected?.services ?? [];
  const pathHint = detecting
    ? 'Čtu složku…'
    : detected?.exists
      ? `Rozpoznáno: ${KIND_LABEL[detected.kind]}${detected.framework && detected.framework !== 'other' ? `, ${detected.framework}` : ''}`
      : 'Vlož cestu, typ se pozná sám.';

  return (
    <motion.div
      className="fixed inset-0 z-40 flex justify-end bg-zinc-950/30 backdrop-blur-[2px] dark:bg-zinc-950/60"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.form
        role="dialog"
        aria-modal
        aria-labelledby="form-title"
        initial={{ x: 24, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 24, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex h-[100dvh] w-full flex-col border-l border-zinc-200 bg-white shadow-[0_0_40px_-12px_rgb(24_24_27/0.25)] md:w-[540px] dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 id="form-title" className="text-base font-semibold tracking-tight">
            {editing ? 'Upravit projekt' : 'Nový projekt'}
          </h2>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Zavřít">
            <X className="size-4" />
          </Button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <Field label="Složka projektu" htmlFor="f-path" error={errors.path} hint={pathHint}>
            <div className="flex gap-2">
              <Input
                id="f-path"
                ref={pathRef}
                mono
                value={path}
                placeholder="C:\Users\...\muj-web"
                invalid={Boolean(errors.path)}
                onChange={(e) => setPath(e.target.value)}
                onBlur={() => path.trim() && path !== detected?.path && void runDetect(path, true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void runDetect(path, true);
                  }
                }}
              />
              <Button type="button" size="icon" className="h-9 w-9" onClick={() => void runDetect(path, true)} disabled={!path.trim()} aria-label="Načíst složku">
                {detecting ? <CircleNotch className="size-4 animate-spin" /> : <MagnifyingGlass className="size-4" />}
              </Button>
            </div>
          </Field>

          <Field label="Název" htmlFor="f-name" error={errors.name}>
            <Input
              id="f-name"
              value={name}
              invalid={Boolean(errors.name)}
              onChange={(e) => {
                nameTouched.current = true;
                setName(e.target.value);
              }}
            />
          </Field>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Typ</legend>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 sm:grid-cols-3 dark:bg-zinc-900">
              {KINDS.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  onClick={() => setKind(k.kind)}
                  aria-pressed={kind === k.kind}
                  className={cx(
                    'rounded-md px-2 py-1.5 text-left transition-[background-color,color,box-shadow] duration-200 active:scale-[0.98]',
                    kind === k.kind
                      ? 'bg-white text-zinc-900 shadow-[0_1px_2px_rgb(24_24_27/0.08)] dark:bg-zinc-800 dark:text-zinc-50'
                      : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200',
                  )}
                >
                  <span className="block text-[13px] font-medium">{KIND_LABEL[k.kind]}</span>
                  <span className="block text-[11px] text-zinc-500">{k.hint}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {kind === 'npm' && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Skript" htmlFor="f-script" error={errors.script}>
                {scripts.length ? (
                  <select id="f-script" className={cx(selectClass, 'font-mono text-[13px]')} value={script} onChange={(e) => setScript(e.target.value)}>
                    {scripts.map(([s]) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input id="f-script" mono value={script} onChange={(e) => setScript(e.target.value)} placeholder="dev" />
                )}
              </Field>
              <Field label="Framework" htmlFor="f-fw" hint="Určuje, jak se předá port.">
                <select id="f-fw" className={selectClass} value={framework} onChange={(e) => setFramework(e.target.value as Framework)}>
                  {FRAMEWORKS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              {script && detected?.scripts[script] && (
                <p className="break-all font-mono text-xs text-zinc-500 sm:col-span-2">
                  {script}: {detected.scripts[script]}
                </p>
              )}
            </div>
          )}

          {kind === 'custom' && (
            <Field
              label="Příkaz"
              htmlFor="f-cmd"
              error={errors.command}
              hint={
                <>
                  Spustí se v shellu ve složce projektu. <code className="font-mono">{'{port}'}</code> se nahradí portem, env{' '}
                  <code className="font-mono">PORT</code> je nastavené vždy.
                </>
              }
            >
              <Input
                id="f-cmd"
                mono
                value={command}
                invalid={Boolean(errors.command)}
                placeholder="python -m http.server {port}"
                onChange={(e) => setCommand(e.target.value)}
              />
            </Field>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Port"
              htmlFor="f-port"
              error={errors.port}
              hint={
                portCheck ? (
                  portCheck.free ? (
                    <span>Volný{portCheck.project ? `, ale v konfiguraci ho má ${portCheck.project}` : ''}</span>
                  ) : (
                    <span className="text-red-600 dark:text-red-400">
                      Drží ho <span className="font-mono">{portCheck.owner?.name}</span> (PID <span className="font-mono">{portCheck.owner?.pid}</span>)
                    </span>
                  )
                ) : (
                  <span>
                    Odkaz bude <span className="font-mono">http://localhost:{port || '…'}</span>
                  </span>
                )
              }
            >
              <div className="flex gap-2">
                <Input
                  id="f-port"
                  mono
                  inputMode="numeric"
                  value={port}
                  invalid={Boolean(errors.port)}
                  onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                />
                <Button
                  type="button"
                  className="h-9"
                  onClick={async () => setPort(String((await api.freePort(portNum ? portNum + 1 : undefined, project?.id)).port))}
                >
                  Volný
                </Button>
              </div>
            </Field>

            {(kind === 'compose' || kind === 'dockerfile') && (
              <Field
                label="Port v kontejneru"
                htmlFor="f-cport"
                error={errors.containerPort}
                hint={
                  detected?.containerPort
                    ? `Načteno z ${kind === 'compose' ? 'compose' : 'EXPOSE v Dockerfile'}`
                    : 'Nenašel jsem ho, doplň ručně.'
                }
              >
                <Input
                  id="f-cport"
                  mono
                  inputMode="numeric"
                  value={containerPort}
                  invalid={Boolean(errors.containerPort)}
                  placeholder="80"
                  onChange={(e) => setContainerPort(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
                />
              </Field>
            )}
          </div>

          {kind === 'compose' && services.length > 1 && (
            <Field label="Služba s webem" htmlFor="f-svc" hint="Na tuhle službu se namapuje port.">
              <select id="f-svc" className={cx(selectClass, 'font-mono text-[13px]')} value={service} onChange={(e) => setService(e.target.value)}>
                {services.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                    {s.containerPort ? ` (${s.containerPort})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-zinc-700 dark:text-zinc-300">Proměnné prostředí</span>
              <Button type="button" size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setEnv((r) => [...r, { k: '', v: '' }])}>
                Přidat
              </Button>
            </div>
            {env.length === 0 ? (
              <p className="text-xs text-zinc-500">
                Volitelné. <code className="font-mono">PORT</code> se nastaví vždy.
              </p>
            ) : (
              <div className="space-y-2">
                {env.map((row, i) => (
                  <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] gap-2">
                    <Input
                      mono
                      placeholder="NAZEV"
                      aria-label="Název proměnné"
                      value={row.k}
                      onChange={(e) => setEnv((r) => r.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
                    />
                    <Input
                      mono
                      placeholder="hodnota"
                      aria-label="Hodnota"
                      value={row.v}
                      onChange={(e) => setEnv((r) => r.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
                    />
                    <Button type="button" variant="ghost" size="icon" className="h-9 w-9" aria-label="Odebrat" onClick={() => setEnv((r) => r.filter((_, j) => j !== i))}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {errors.env && <p className="text-xs text-red-600 dark:text-red-400">{errors.env}</p>}
          </div>
        </div>

        <footer className="flex items-center gap-3 border-t border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          {errors.form && <p className="min-w-0 flex-1 text-xs text-red-600 dark:text-red-400">{errors.form}</p>}
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Zrušit
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {editing ? 'Uložit' : 'Přidat projekt'}
            </Button>
          </div>
        </footer>
      </motion.form>
    </motion.div>
  );
}
