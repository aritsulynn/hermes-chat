// Plugins route — installed agent plugins, the curated catalog, and runtime
// provider selection (memory provider / context engine).
//
// Ported from Hermes Desktop's `PluginsPage.tsx`. Scoped to the pieces a phone
// can drive well: the installed-plugin list (enable/disable/update/remove and
// sidebar visibility), the catalog browser with install, and the provider
// pickers. The desktop's per-field memory-provider config editor belongs with
// the broader Memory surface.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Download, Eye, EyeOff, Package, RefreshCw, Store, Trash2, X, Zap } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ConfirmDialog } from '../../components/ui/dialog';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import {
  getPluginsCatalog,
  getPluginsHub,
  installAgentPlugin,
  removeAgentPlugin,
  rescanPlugins,
  savePluginProviders,
  setAgentPluginEnabled,
  setPluginVisibility,
  updateAgentPlugin,
  type AgentPluginRow,
  type CatalogEntry,
  type PluginsHub,
} from '../../services/plugins';

const BUILTIN_MEMORY = '__builtin__';

type Tab = 'installed' | 'catalog' | 'providers';

export function PluginsScreen() {
  const { authed, activeProfile, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [tab, setTab] = useState<Tab>('installed');
  const [hub, setHub] = useState<PluginsHub | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [installing, setInstalling] = useState<CatalogEntry | null>(null);

  const loadEpoch = useRef(0);
  const load = useCallback(
    async (isRefresh = false) => {
      const profile = activeProfile;
      const scope = getAuthScope();
      const epoch = ++loadEpoch.current;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [nextHub, nextCatalog] = await Promise.all([
          getPluginsHub(opsGet, profile),
          getPluginsCatalog(opsGet).catch(() => [] as CatalogEntry[]),
        ]);
        if (getAuthScope() !== scope || activeProfile !== profile || loadEpoch.current !== epoch) return;
        setHub(nextHub);
        setCatalog(nextCatalog);
      } catch (e) {
        if (getAuthScope() === scope && activeProfile === profile && loadEpoch.current === epoch) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope && activeProfile === profile && loadEpoch.current === epoch) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [activeProfile, getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  const onRescan = useCallback(async () => {
    const scope = getAuthScope();
    setBusy('__rescan__');
    try {
      const count = await rescanPlugins(opsGet);
      if (getAuthScope() !== scope) return;
      toast({ title: 'Rescanned', description: `${count} plugin(s) found` });
      await load(true);
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Rescan failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setBusy(null);
    }
  }, [getAuthScope, load, opsGet]);

  if (!authed) return <Redirect to="/login" replace />;

  const ql = query.trim().toLowerCase();

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <>
            <ScreenHeader
              title="Plugins"
              subtitle={
                loading
                  ? 'Loading…'
                  : hub
                    ? `${hub.plugins.filter((p) => p.runtimeStatus === 'enabled').length}/${hub.plugins.length} enabled · ${catalog.length} in catalog`
                    : undefined
              }
              actions={
                <HeaderIconButton aria-label="Rescan plugins" onClick={() => void onRescan()}>
                  <RefreshCw
                    size={20}
                    color={dark ? '#e5e5e5' : '#333'}
                    className={busy === '__rescan__' || refreshing ? 'animate-spin' : ''}
                  />
                </HeaderIconButton>
              }
            />
            <div className="flex gap-1.5 border-b border-border px-3 py-2">
              {(
                [
                  ['installed', 'Installed'],
                  ['catalog', 'Catalog'],
                  ['providers', 'Providers'],
                ] as const
              ).map(([t, label]) => (
                <Button
                  key={t}
                  variant="ghost"
                  aria-pressed={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-auto sm:h-auto rounded-lg border px-3 py-1.5 ${tab === t ? 'border-brand bg-brand/10' : 'border-border'}`}>
                  <span
                    className={`text-xs font-semibold ${tab === t ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                    {label}
                  </span>
                </Button>
              ))}
            </div>
          </>
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : tab === 'providers' ? (
            <ProvidersPanel hub={hub} opsMut={opsMut} profile={activeProfile} getAuthScope={getAuthScope} />
          ) : (
            <>
              <div className="px-1">
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === 'installed' ? 'Search installed plugins…' : 'Search catalog…'}
                  aria-label="Search plugins"
                  autoCapitalize="none"
                  className="rounded-xl border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
                />
              </div>
              {tab === 'installed' ? (
                <InstalledList
                  hub={hub}
                  query={ql}
                  dark={dark}
                  busy={busy}
                  setBusy={setBusy}
                  opsMut={opsMut}
                  getAuthScope={getAuthScope}
                  onChanged={() => void load(true)}
                  setConfirm={setConfirm}
                />
              ) : (
                <CatalogList catalog={catalog} query={ql} dark={dark} busy={busy} onInstall={(e) => setInstalling(e)} />
              )}
            </>
          )}
        </div>
      </ScreenScaffold>

      {installing && (
        <InstallSheet
          entry={installing}
          dark={dark}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onClose={() => setInstalling(null)}
          onInstalled={() => {
            setInstalling(null);
            void load(true);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.body}
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirm?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      />
    </div>
  );
}

function statusTone(status: string): string {
  switch (status) {
    case 'enabled':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'disabled':
      return 'text-red-500';
    default:
      return 'text-neutral-500 dark:text-neutral-400';
  }
}

function InstalledList({
  hub,
  query,
  dark,
  busy,
  setBusy,
  opsMut,
  getAuthScope,
  onChanged,
  setConfirm,
}: {
  hub: PluginsHub | null;
  query: string;
  dark: boolean;
  busy: string | null;
  setBusy: (v: string | null) => void;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onChanged: () => void;
  setConfirm: (v: { title: string; body: string; run: () => void } | null) => void;
}) {
  const rows = useMemo(() => {
    const list = hub?.plugins ?? [];
    if (!query) return list;
    return list.filter((p) =>
      [p.name, p.description, p.source].some((v) =>
        String(v ?? '')
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [hub, query]);

  if (rows.length === 0) {
    return (
      <Card>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">No matching installed plugins.</div>
      </Card>
    );
  }

  return (
    <>
      {rows.map((p) => (
        <PluginRow
          key={`${p.name}:${p.path}`}
          platform={p}
          dark={dark}
          busy={busy}
          setBusy={setBusy}
          opsMut={opsMut}
          getAuthScope={getAuthScope}
          onChanged={onChanged}
          setConfirm={setConfirm}
        />
      ))}
    </>
  );
}

function PluginRow({
  platform: p,
  dark,
  busy,
  setBusy,
  opsMut,
  getAuthScope,
  onChanged,
  setConfirm,
}: {
  platform: AgentPluginRow;
  dark: boolean;
  busy: string | null;
  setBusy: (v: string | null) => void;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onChanged: () => void;
  setConfirm: (v: { title: string; body: string; run: () => void } | null) => void;
}) {
  const enabled = p.runtimeStatus === 'enabled';
  const rowBusy = busy === p.name;

  const toggle = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(p.name);
    try {
      await setAgentPluginEnabled(opsMut, p.name, !enabled);
      if (getAuthScope() !== scope) return;
      toast({ title: enabled ? 'Plugin disabled' : 'Plugin enabled', description: p.name });
      onChanged();
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Update failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setBusy(null);
    }
  }, [enabled, getAuthScope, onChanged, opsMut, p.name, setBusy]);

  const update = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(p.name);
    try {
      const res = await updateAgentPlugin(opsMut, p.name);
      if (getAuthScope() !== scope) return;
      if (res.consentRequired) {
        toast({
          title: 'Capabilities changed',
          description: res.deltaLines.join(' ') || 'Re-run the update to accept the new capabilities.',
          variant: 'destructive',
        });
      } else if (res.unchanged) {
        toast({ title: 'Already up to date', description: p.name });
      } else {
        toast({ title: 'Plugin updated', description: p.name });
        onChanged();
      }
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Update failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setBusy(null);
    }
  }, [getAuthScope, onChanged, opsMut, p.name, setBusy]);

  const toggleVisibility = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(p.name);
    try {
      await setPluginVisibility(opsMut, p.name, !p.userHidden);
      if (getAuthScope() !== scope) return;
      toast({ title: p.userHidden ? 'Shown in sidebar' : 'Hidden from sidebar', description: p.name });
      onChanged();
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Update failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setBusy(null);
    }
  }, [getAuthScope, onChanged, opsMut, p.name, p.userHidden, setBusy]);

  const remove = useCallback(() => {
    setConfirm({
      title: 'Remove plugin',
      body: `Remove plugin "${p.name}"? Its directory is deleted. This cannot be undone.`,
      run: async () => {
        const scope = getAuthScope();
        setBusy(p.name);
        try {
          await removeAgentPlugin(opsMut, p.name);
          if (getAuthScope() !== scope) return;
          toast({ title: 'Plugin removed', description: p.name });
          onChanged();
        } catch (e) {
          if (getAuthScope() === scope)
            toast({ title: 'Remove failed', description: errMsg(e), variant: 'destructive' });
        } finally {
          if (getAuthScope() === scope) setBusy(null);
        }
      },
    });
  }, [getAuthScope, onChanged, opsMut, p.name, setBusy, setConfirm]);

  return (
    <Card>
      <div className="flex items-start gap-2">
        <Package size={17} color={enabled ? brandColor(dark) : dark ? '#888' : '#999'} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{p.name}</span>
            <span className={`text-[11px] font-semibold ${statusTone(p.runtimeStatus)}`}>{p.runtimeStatus}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
              {p.source}
            </span>
            {p.authRequired && (
              <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                auth needed
              </span>
            )}
            {p.userHidden && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">hidden</span>
            )}
          </div>
          {!!p.description && (
            <div className="mt-0.5 line-clamp-3 text-xs text-neutral-500 dark:text-neutral-400">{p.description}</div>
          )}
          {!!p.removedReason && (
            <div className="mt-1 text-[11px] text-red-500">Removed from catalog: {p.removedReason}</div>
          )}
          {p.authRequired && !!p.authCommand && (
            <div className="mt-1 truncate font-mono text-[10px] text-neutral-400">{p.authCommand}</div>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border pt-2.5">
        <Button
          aria-label={`${enabled ? 'Disable' : 'Enable'} ${p.name}`}
          variant="outline"
          onClick={() => void toggle()}
          disabled={rowBusy}
          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
          {rowBusy ? (
            <Spinner size={13} color={brandColor(dark)} />
          ) : enabled ? (
            <EyeOff size={13} color={brandColor(dark)} />
          ) : (
            <Eye size={13} color={brandColor(dark)} />
          )}
          <span className="text-xs font-semibold">{enabled ? 'Disable' : 'Enable'}</span>
        </Button>
        <Button
          aria-label={`Toggle visibility for ${p.name}`}
          variant="outline"
          onClick={() => void toggleVisibility()}
          disabled={rowBusy}
          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
          {p.userHidden ? <Eye size={13} color={brandColor(dark)} /> : <EyeOff size={13} color={brandColor(dark)} />}
          <span className="text-xs font-semibold">{p.userHidden ? 'Show' : 'Hide'}</span>
        </Button>
        {p.canUpdateGit && (
          <Button
            aria-label={`Update ${p.name}`}
            variant="outline"
            onClick={() => void update()}
            disabled={rowBusy}
            className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
            <Zap size={13} color={brandColor(dark)} />
            <span className="text-xs font-semibold">Update</span>
          </Button>
        )}
        {p.canRemove && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Remove ${p.name}`}
            onClick={remove}
            disabled={rowBusy}
            className="ml-auto rounded-lg">
            <Trash2 size={15} color="#ef4444" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function CatalogList({
  catalog,
  query,
  dark,
  busy,
  onInstall,
}: {
  catalog: CatalogEntry[];
  query: string;
  dark: boolean;
  busy: string | null;
  onInstall: (e: CatalogEntry) => void;
}) {
  const rows = useMemo(() => {
    if (!query) return catalog;
    return catalog.filter((e) =>
      [e.name, e.title, e.description, e.category, e.tier].some((v) =>
        String(v ?? '')
          .toLowerCase()
          .includes(query),
      ),
    );
  }, [catalog, query]);

  if (rows.length === 0) {
    return (
      <Card>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">No matching catalog entries.</div>
      </Card>
    );
  }

  return (
    <>
      {rows.map((e) => (
        <Card key={e.name}>
          <div className="flex items-start gap-2">
            <Store size={17} color={dark ? '#888' : '#666'} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{e.title}</span>
                {e.installed && (
                  <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                    installed
                  </span>
                )}
                {e.updateAvailable && (
                  <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                    update
                  </span>
                )}
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                  {e.tier}
                </span>
              </div>
              {!!e.description && (
                <div className="mt-0.5 line-clamp-3 text-xs text-neutral-500 dark:text-neutral-400">
                  {e.description}
                </div>
              )}
              <div className="mt-1 flex flex-wrap gap-1">
                {e.capabilities.providesTools.length > 0 && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-neutral-500">
                    {e.capabilities.providesTools.length} tools
                  </span>
                )}
                {e.capabilities.providesHooks.length > 0 && (
                  <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-neutral-500">
                    {e.capabilities.providesHooks.length} hooks
                  </span>
                )}
                {e.capabilities.requiresEnv.length > 0 && (
                  <span className="rounded border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-600 dark:border-amber-800 dark:text-amber-400">
                    needs {e.capabilities.requiresEnv.length} env
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2.5">
            <span className="truncate font-mono text-[10px] text-neutral-400">
              {e.maintainer} · {e.shaShort}
            </span>
            <Button
              aria-label={`Install ${e.name}`}
              onClick={() => onInstall(e)}
              disabled={busy === e.name}
              className="ml-auto h-auto sm:h-auto rounded-lg px-3 py-1.5">
              <Download size={13} color="#fff" />
              <span className="text-xs font-semibold text-white">{e.installed ? 'Reinstall' : 'Install'}</span>
            </Button>
          </div>
        </Card>
      ))}
    </>
  );
}

function InstallSheet({
  entry,
  dark,
  opsMut,
  getAuthScope,
  onClose,
  onInstalled,
}: {
  entry: CatalogEntry;
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [enable, setEnable] = useState(!entry.installed);
  const [force, setForce] = useState(entry.installed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const install = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(true);
    setErr(null);
    try {
      const res = await installAgentPlugin(opsMut, { catalogName: entry.name, force, enable });
      if (getAuthScope() !== scope) return;
      if (res.warnings.length > 0)
        toast({ title: 'Installed with warnings', description: res.warnings.join(' '), variant: 'destructive' });
      else if (res.missingEnv.length > 0)
        toast({ title: 'Missing env vars', description: res.missingEnv.join(', '), variant: 'destructive' });
      else toast({ title: 'Plugin installed', description: res.pluginName || entry.name });
      onInstalled();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [enable, entry.name, force, getAuthScope, onInstalled, opsMut]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Install {entry.title}</DialogPrimitive.Title>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close install"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">
                Install {entry.title}
              </div>
              <Button
                aria-label="Confirm install"
                onClick={() => void install()}
                disabled={busy}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {busy ? <Spinner size={14} color="#fff" /> : <Download size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Install</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-3">
                {!!entry.description && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">{entry.description}</p>
                )}
                <div className="rounded-xl border border-border p-3 text-[11px] text-neutral-500">
                  <div className="truncate font-mono">{entry.repo}</div>
                  <div className="mt-0.5">
                    {entry.maintainer} · {entry.shaShort}
                  </div>
                </div>
                {entry.capabilities.requiresEnv.length > 0 && (
                  <div>
                    <Label className="mb-1 text-[11px] font-semibold">Required env vars</Label>
                    <div className="flex flex-wrap gap-1">
                      {entry.capabilities.requiresEnv.map((k) => (
                        <span
                          key={k}
                          className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <ToggleRow checked={enable} onChange={setEnable} label="Enable the plugin after install" />
                <ToggleRow checked={force} onChange={setForce} label="Force reinstall over an existing directory" />
                {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ToggleRow({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left ${checked ? 'border-brand bg-brand/10' : 'border-border'}`}>
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-md border ${checked ? 'border-brand bg-brand' : 'border-border'}`}>
        {checked && <Check size={12} color="#fff" />}
      </span>
      <span className="text-xs text-neutral-700 dark:text-neutral-300">{label}</span>
    </button>
  );
}

function ProvidersPanel({
  hub,
  opsMut,
  profile,
  getAuthScope,
}: {
  hub: PluginsHub | null;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  profile: string | null;
  getAuthScope: () => unknown;
}) {
  const providers = hub?.providers;
  const [memorySel, setMemorySel] = useState(BUILTIN_MEMORY);
  const [contextSel, setContextSel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!providers) return;
    setMemorySel(providers.memoryProvider || BUILTIN_MEMORY);
    setContextSel(providers.contextEngine || 'compressor');
  }, [providers]);

  const save = useCallback(async () => {
    const scope = getAuthScope();
    setBusy(true);
    setError(null);
    try {
      await savePluginProviders(
        opsMut,
        {
          memoryProvider: memorySel === BUILTIN_MEMORY ? '' : memorySel,
          ...(contextSel ? { contextEngine: contextSel } : {}),
        },
        profile,
      );
      if (getAuthScope() !== scope) return;
      toast({ title: 'Providers saved' });
    } catch (e) {
      if (getAuthScope() === scope) setError(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setBusy(false);
    }
  }, [contextSel, getAuthScope, memorySel, opsMut, profile]);

  const selected = providers?.memoryOptions.find((m) => m.name === memorySel);

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <div className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-100">Memory provider</div>
        <Select value={memorySel} onValueChange={setMemorySel}>
          <SelectTrigger className="w-full" aria-label="Memory provider">
            <SelectValue placeholder="Select a provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BUILTIN_MEMORY}>Built-in (MEMORY.md / USER.md)</SelectItem>
            {(providers?.memoryOptions ?? []).map((o) => (
              <SelectItem key={o.name} value={o.name}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selected && (
          <div className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            {selected.description}
            <span
              className={`ml-1 font-semibold ${selected.status === 'ready' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              ({selected.status})
            </span>
          </div>
        )}
        {memorySel === BUILTIN_MEMORY && (
          <div className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            Hermes will use the built-in MEMORY.md and USER.md files.
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-2 text-xs font-semibold text-neutral-900 dark:text-neutral-100">Context engine</div>
        <Select value={contextSel} onValueChange={setContextSel}>
          <SelectTrigger className="w-full" aria-label="Context engine">
            <SelectValue placeholder="Select an engine" />
          </SelectTrigger>
          <SelectContent>
            {(providers?.contextOptions ?? []).map((o) => (
              <SelectItem key={o.name} value={o.name}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!!(providers?.contextOptions ?? []).find((o) => o.name === contextSel)?.description && (
          <div className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            {(providers?.contextOptions ?? []).find((o) => o.name === contextSel)?.description}
          </div>
        )}
      </Card>

      {error && <div className="whitespace-pre-wrap px-1 text-xs text-red-600 dark:text-red-400">{error}</div>}

      <Button
        aria-label="Save providers"
        onClick={() => void save()}
        disabled={busy}
        className="h-auto sm:h-auto rounded-xl px-4 py-2.5">
        {busy ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
        <span className="text-sm font-semibold text-white">Save providers</span>
      </Button>
      {!providers && <div className="text-[11px] text-neutral-400">Provider metadata unavailable.</div>}
    </div>
  );
}
