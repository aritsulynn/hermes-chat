// Models route — the model-assignment management surface.
//
// Ported from Hermes Desktop's `ModelsPage.tsx`, scoped to the pieces a phone
// drives well: the resolved main model with context/capability badges, and the
// auxiliary task assignments (view, per-task assign, reset-all) using the same
// provider inventory as the composer picker. The desktop's Mixture-of-Agents
// preset editor is a large separate renderer and is not ported.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import { Cpu, RefreshCw, RotateCcw, Star, Wrench } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import { getModelOptions } from '../../services/dashboard';
import type { ModelProviderOption } from '../../services/dashboard';
import {
  AUX_TASKS,
  formatContext,
  getAuxiliaryModels,
  getModelInfo,
  setModelAssignment,
  type AuxiliaryModels,
  type ModelInfo,
} from '../../services/models-admin';

export function ModelsScreen() {
  const { authed, activeProfile, host, getCookie, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [picker, setPicker] = useState<AuxiliarySlot | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);

  // Two queries, one per endpoint — same content as the old paired loads,
  // each keyed so a superseded response can never render.
  const infoQ = useOpsQuery<ModelInfo>({
    key: ['models', 'info'],
    get: (get) => getModelInfo(get, activeProfile),
    enabled: authed,
  });
  const auxQ = useOpsQuery<AuxiliaryModels>({
    key: ['models', 'aux'],
    get: (get) => getAuxiliaryModels(get, activeProfile),
    enabled: authed,
  });
  const info = infoQ.data ?? null;
  const aux = auxQ.data ?? null;
  const loading = infoQ.isPending || auxQ.isPending;
  const refreshing = infoQ.isRefetching || auxQ.isRefetching;
  const firstError = infoQ.error ?? auxQ.error;
  const error = firstError ? errMsg(firstError) : null;
  const refresh = useCallback(() => {
    void infoQ.refetch();
    void auxQ.refetch();
  }, [infoQ, auxQ]);

  const overrideCount = useMemo(() => (aux ? aux.tasks.filter((t) => t.model).length : 0), [aux]);

  const assign = useOpsMutation<
    { confirmRequired?: boolean; confirmMessage?: string },
    { task: string; provider: string; model: string; reasoningEffort?: string | null }
  >({
    mutationFn: (mut, v) =>
      setModelAssignment(mut, {
        scope: 'auxiliary',
        task: v.task,
        provider: v.provider,
        model: v.model,
        ...(v.reasoningEffort !== undefined ? { reasoningEffort: v.reasoningEffort } : {}),
        profile: activeProfile,
      }),
    done: [['models', 'info'], ['models', 'aux']],
    onSuccess: (res, v) => {
      if (res.confirmRequired) {
        toast({
          title: 'Confirm model',
          description: res.confirmMessage || 'This model may be expensive.',
          variant: 'destructive',
        });
        return;
      }
      toast({ title: v.model ? 'Task assigned' : 'Task reset', description: `${v.task} · ${v.model || 'auto'}` });
      setPicker(null);
    },
    onError: (e) => toast({ title: 'Assign failed', description: errMsg(e), variant: 'destructive' }),
  });

  const resetAll = useOpsMutation<unknown, void>({
    mutationFn: (mut) =>
      setModelAssignment(mut, {
        scope: 'auxiliary',
        provider: 'auto',
        model: '',
        task: '__reset__',
        profile: activeProfile,
      }),
    done: [['models', 'info'], ['models', 'aux']],
    onSuccess: () => { toast({ title: 'All tasks reset to auto' }); },
    onError: (e) => toast({ title: 'Reset failed', description: errMsg(e), variant: 'destructive' }),
  });

  const busyTask = assign.isPending && assign.variables ? assign.variables.task : resetAll.isPending ? '__reset__' : null;

  const assignTask = useCallback(
    (task: string, provider: string, model: string, reasoningEffort?: string | null) => {
      assign.mutate({ task, provider, model, reasoningEffort });
    },
    [assign],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Models"
            subtitle={loading ? 'Loading…' : aux ? `${overrideCount}/${aux.tasks.length} aux overrides` : undefined}
            actions={
              <HeaderIconButton aria-label="Refresh models" onClick={refresh}>
                <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
              </HeaderIconButton>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={refresh} />
          ) : (
            <>
              <Card>
                <div className="mb-1.5 flex items-center gap-1.5">
                  <Star size={14} color={brand} />
                  <span className="text-xs font-bold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                    Main model
                  </span>
                </div>
                {info?.model ? (
                  <>
                    <div className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      {info.model}
                    </div>
                    <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                      {[info.provider, info.capabilities.modelFamily].filter(Boolean).join(' · ')}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge label={`${formatContext(info.effectiveContextLength)} ctx`} dark={dark} />
                      {info.configContextLength > 0 && (
                        <Badge label={`override ${formatContext(info.configContextLength)}`} dark={dark} />
                      )}
                      {info.autoContextLength > 0 && (
                        <Badge label={`auto ${formatContext(info.autoContextLength)}`} dark={dark} />
                      )}
                      {info.capabilities.supportsTools && <Badge label="tools" dark={dark} />}
                      {info.capabilities.supportsVision && <Badge label="vision" dark={dark} />}
                      {info.capabilities.supportsReasoning && <Badge label="reasoning" dark={dark} />}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-neutral-500 dark:text-neutral-400">No main model configured.</div>
                )}
              </Card>

              <div className="flex items-center justify-between px-1">
                <div className="text-[11px] font-bold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  Auxiliary tasks
                </div>
                {overrideCount > 0 && (
                  <Button
                    variant="ghost"
                    aria-label="Reset all auxiliary tasks"
                    onClick={() => setResetConfirm(true)}
                    disabled={busyTask === '__reset__'}
                    className="h-auto sm:h-auto rounded-lg border border-border px-2.5 py-1">
                    <RotateCcw size={12} color={brand} />
                    <span className="text-[11px] font-semibold">Reset all</span>
                  </Button>
                )}
              </div>

              {(aux?.tasks ?? []).map((t) => {
                const meta = AUX_TASKS.find((a) => a.key === t.task);
                return (
                  <Card key={t.task}>
                    <div className="flex items-start gap-2">
                      <Wrench size={15} color={t.model ? brand : dark ? '#888' : '#999'} className="mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                            {meta?.label ?? t.task}
                          </span>
                          <span className={`text-[11px] font-semibold ${t.model ? 'text-brand' : 'text-neutral-400'}`}>
                            {t.model ? t.provider : 'auto'}
                          </span>
                          {t.localEndpoint && <Badge label="local" dark={dark} />}
                        </div>
                        {!!meta?.hint && <div className="mt-0.5 text-[11px] text-neutral-400">{meta.hint}</div>}
                        {t.model && (
                          <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                            {t.model}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2.5">
                      <Button
                        aria-label={`Assign ${t.task}`}
                        variant="outline"
                        onClick={() => setPicker({ task: t.task, label: meta?.label ?? t.task })}
                        disabled={busyTask === t.task}
                        className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                        {busyTask === t.task ? <Spinner size={13} color={brand} /> : <Cpu size={13} color={brand} />}
                        <span className="text-xs font-semibold">{t.model ? 'Change' : 'Assign'}</span>
                      </Button>
                      {t.model && (
                        <Button
                          aria-label={`Reset ${t.task}`}
                          variant="ghost"
                          onClick={() => assignTask(t.task, "auto", "")}
                          disabled={busyTask === t.task}
                          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                          <span className="text-xs font-semibold text-neutral-500">Reset</span>
                        </Button>
                      )}
                    </div>
                  </Card>
                );
              })}
            </>
          )}
        </div>
      </ScreenScaffold>

      {picker && (
        <ModelPickerSheet
          slot={picker}
          dark={dark}
          host={host}
          getCookie={getCookie}
          profile={activeProfile}
          getAuthScope={getAuthScope}
          busy={busyTask === picker.task}
          onPick={(provider, model) => assignTask(picker.task, provider, model)}
          onClose={() => setPicker(null)}
        />
      )}

      <ConfirmDialog
        open={resetConfirm}
        title="Reset all auxiliary tasks"
        description="Every auxiliary task returns to the automatic provider."
        confirmLabel="Reset all"
        destructive
        onConfirm={() => resetAll.mutate()}
        onOpenChange={(o) => {
          if (!o) setResetConfirm(false);
        }}
      />
    </div>
  );
}

type AuxiliarySlot = { task: string; label: string };

function Badge({ label, dark }: { label: string; dark: boolean }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] text-neutral-600 dark:text-neutral-300 ${dark ? 'border-neutral-700' : 'border-neutral-300'}`}>
      {label}
    </span>
  );
}

function ModelPickerSheet({
  slot,
  dark,
  host,
  getCookie,
  profile,
  getAuthScope,
  busy,
  onPick,
  onClose,
}: {
  slot: AuxiliarySlot;
  dark: boolean;
  host: string;
  getCookie: () => string;
  profile: string | null;
  getAuthScope: () => unknown;
  busy: boolean;
  onPick: (provider: string, model: string) => void;
  onClose: () => void;
}) {
  const [providers, setProviders] = useState<ModelProviderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const scope = getAuthScope();
    setProviders(null);
    setError(null);
    getModelOptions(host, getCookie(), { profile: profile ?? undefined })
      .then((rows) => {
        if (cancelled || getAuthScope() !== scope) return;
        setProviders(rows);
        const first = rows.find((p) => p.models && p.models.length > 0);
        setActiveProvider(first?.slug ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
    // Load once per opened sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = useMemo(() => {
    if (!providers) return [];
    return activeProvider ? providers.filter((p) => p.slug === activeProvider) : providers;
  }, [providers, activeProvider]);

  const withModels = useMemo(() => (providers ?? []).filter((p) => p.models && p.models.length > 0), [providers]);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-popover dark:bg-background">
      <div
        className="flex items-center gap-2 border-b border-border px-4 py-3"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Close model picker"
          onClick={onClose}
          className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
          <span className="text-lg" style={{ color: dark ? '#eee' : '#333' }}>
            ✕
          </span>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold text-neutral-900 dark:text-white">Assign model</div>
          <div className="truncate text-[11px] text-neutral-400">{slot.label}</div>
        </div>
        {busy && <Spinner size={16} color={brandColor(dark)} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 text-xs text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        ) : !providers ? (
          <div className="flex items-center justify-center py-16">
            <Spinner size={22} color={brandColor(dark)} />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {withModels.map((p) => (
                <Button
                  key={p.slug}
                  variant="ghost"
                  aria-pressed={activeProvider === p.slug}
                  onClick={() => setActiveProvider(p.slug)}
                  className={`h-auto sm:h-auto rounded-lg border px-2.5 py-1.5 ${activeProvider === p.slug ? 'border-brand bg-brand/10' : 'border-border'}`}>
                  <span
                    className={`text-[11px] font-semibold ${activeProvider === p.slug ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                    {p.name}
                  </span>
                </Button>
              ))}
            </div>
            {list.map((p) => (
              <div key={p.slug}>
                <div className="mb-1 px-1 text-[11px] font-bold tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
                  {p.name}
                </div>
                <div className="flex flex-col gap-1">
                  {(p.models ?? []).map((m) => (
                    <button
                      key={`${p.slug}:${m}`}
                      type="button"
                      aria-label={`Use ${m}`}
                      onClick={() => onPick(p.slug, m)}
                      disabled={busy}
                      className="truncate rounded-lg border border-border px-3 py-2 text-left font-mono text-xs text-neutral-700 hover:bg-neutral-100 disabled:opacity-50 dark:text-neutral-200 dark:hover:bg-neutral-800">
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
