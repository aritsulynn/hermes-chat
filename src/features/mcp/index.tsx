// MCP route — configured servers and the Nous-approved catalog.
//
// Ported from Hermes Desktop's `McpPage.tsx`, re-skinned for mobile. Two
// sections: the servers the profile has configured (toggle, test, OAuth,
// delete) and the catalog of installable entries (install with declared env
// secrets; git-bootstrap entries run as a background action).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Download, ExternalLink, Plus, RefreshCw, Server, Shield, Trash2, X, Zap } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Switch } from '../../components/ui/switch';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import * as api from '../../services/api';
import { normalizeActionStatus } from '../../services/hermes-update';
import {
  addMcpServer,
  deleteMcpServer,
  getMcpCatalog,
  getMcpServers,
  installMcpCatalogEntry,
  setMcpServerEnabled,
  startMcpAuth,
  testMcpServer,
  type McpCatalogEntry,
  type McpServer,
  type McpServerTestResult,
} from '../../services/mcp';

type Mode = 'servers' | 'catalog';

function transportBadgeClass(t: string): string {
  switch (t) {
    case 'http':
      return 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
    case 'stdio':
      return 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
    default:
      return 'border-border bg-muted text-neutral-600 dark:text-neutral-300';
  }
}

export function McpScreen() {
  const { authed, activeProfile, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);
  const profile = activeProfile;

  const [mode, setMode] = useState<Mode>('servers');
  const [servers, setServers] = useState<McpServer[]>([]);
  const [catalog, setCatalog] = useState<McpCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [toggling, setToggling] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, McpServerTestResult>>({});
  const [authenticating, setAuthenticating] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [installEntry, setInstallEntry] = useState<McpCatalogEntry | null>(null);
  const [installEnv, setInstallEnv] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  // Live action log for a git-bootstrap install.
  const [action, setAction] = useState<string | null>(null);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const [actionRunning, setActionRunning] = useState(false);

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const load = useCallback(
    async (isRefresh = false) => {
      const scope = getAuthScope();
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const [nextServers, nextCatalog] = await Promise.all([
          getMcpServers(opsGet, profile),
          getMcpCatalog(opsGet, profile).catch((e) => {
            console.warn('[mcp] catalog unavailable', e);
            return { entries: [], diagnostics: [] };
          }),
        ]);
        if (getAuthScope() !== scope) return;
        setServers(nextServers);
        setCatalog(nextCatalog.entries);
      } catch (e) {
        if (getAuthScope() === scope) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getAuthScope, opsGet, profile],
  );

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  // Poll a git-bootstrap install action.
  useEffect(() => {
    if (!action) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const scope = getAuthScope();
      try {
        const raw = await opsGet(api.actionStatus(action, 300));
        if (cancelled || getAuthScope() !== scope) return;
        const st = normalizeActionStatus(raw);
        setActionLog(st.lines);
        setActionRunning(st.running);
        if (st.running) timer = setTimeout(tick, 1200);
        else void load(true);
      } catch {
        if (!cancelled) setActionRunning(false);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [action, getAuthScope, load, opsGet]);

  const toggleServer = useCallback(
    async (server: McpServer, enabled: boolean) => {
      const scope = getAuthScope();
      setToggling(server.name);
      setServers((prev) => prev.map((s) => (s.name === server.name ? { ...s, enabled } : s)));
      try {
        await setMcpServerEnabled(opsMut, server.name, enabled);
        if (getAuthScope() !== scope) return;
      } catch (e) {
        if (getAuthScope() !== scope) return;
        setServers((prev) => prev.map((s) => (s.name === server.name ? { ...s, enabled: !enabled } : s)));
        toast({ title: 'Toggle failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setToggling(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const runTest = useCallback(
    async (server: McpServer) => {
      const scope = getAuthScope();
      setTesting(server.name);
      try {
        const res = await testMcpServer(opsMut, server.name);
        if (getAuthScope() !== scope) return;
        setTests((prev) => ({ ...prev, [server.name]: res }));
      } catch (e) {
        if (getAuthScope() === scope)
          setTests((prev) => ({
            ...prev,
            [server.name]: { ok: false, error: errMsg(e), tools: [], prompts: 0, resources: 0 },
          }));
      } finally {
        if (getAuthScope() === scope) setTesting(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const runAuth = useCallback(
    async (server: McpServer) => {
      const scope = getAuthScope();
      setAuthenticating(server.name);
      try {
        const { url } = await startMcpAuth(opsMut, server.name);
        if (getAuthScope() !== scope) return;
        if (url) {
          window.open(url, '_blank', 'noopener');
          toast({ title: 'Authorize in the browser', description: server.name });
        } else {
          toast({ title: 'No authorization URL returned', variant: 'destructive' });
        }
      } catch (e) {
        if (getAuthScope() === scope) toast({ title: 'Auth failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setAuthenticating(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const removeServer = useCallback(
    async (server: McpServer) => {
      const scope = getAuthScope();
      try {
        await deleteMcpServer(opsMut, server.name);
        if (getAuthScope() !== scope) return;
        toast({ title: 'Server removed', description: server.name });
        await load(true);
      } catch (e) {
        if (getAuthScope() === scope) toast({ title: 'Delete failed', description: errMsg(e), variant: 'destructive' });
      }
    },
    [getAuthScope, load, opsMut],
  );

  const openInstall = useCallback((entry: McpCatalogEntry) => {
    setInstallEntry(entry);
    const seed: Record<string, string> = {};
    for (const e of entry.requiredEnv) seed[e.name] = '';
    setInstallEnv(seed);
  }, []);

  const doInstall = useCallback(async () => {
    if (!installEntry) return;
    const scope = getAuthScope();
    setInstalling(true);
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(installEnv)) if (v.trim()) env[k] = v.trim();
      const res = await installMcpCatalogEntry(opsMut, { name: installEntry.name, env, enable: true });
      if (getAuthScope() !== scope) return;
      toast({ title: `Installed ${installEntry.name}` });
      setInstallEntry(null);
      if (res.background && res.action) {
        setActionLog([]);
        setActionRunning(true);
        setAction(res.action);
      } else {
        await load(true);
      }
    } catch (e) {
      if (getAuthScope() === scope) toast({ title: 'Install failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      if (getAuthScope() === scope) setInstalling(false);
    }
  }, [getAuthScope, installEntry, installEnv, load, opsMut]);

  const ql = query.trim().toLowerCase();
  const visibleServers = useMemo(
    () =>
      ql
        ? servers.filter((s) =>
            [s.name, s.url, s.command, s.transport].some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(ql),
            ),
          )
        : servers,
    [servers, ql],
  );
  const visibleCatalog = useMemo(
    () =>
      ql
        ? catalog.filter((e) =>
            [e.name, e.description, e.source].some((v) =>
              String(v ?? '')
                .toLowerCase()
                .includes(ql),
            ),
          )
        : catalog,
    [catalog, ql],
  );

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <>
            <ScreenHeader
              title="MCP"
              subtitle={`${servers.length} server(s) · ${catalog.length} in catalog`}
              actions={
                <div className="flex items-center gap-1">
                  <HeaderIconButton aria-label="Add MCP server" onClick={() => setAddOpen(true)}>
                    <Plus size={20} color={dark ? '#e5e5e5' : '#333'} />
                  </HeaderIconButton>
                  <HeaderIconButton aria-label="Refresh MCP" onClick={() => void load(true)}>
                    <RefreshCw
                      size={20}
                      color={dark ? '#e5e5e5' : '#333'}
                      className={refreshing ? 'animate-spin' : ''}
                    />
                  </HeaderIconButton>
                </div>
              }
            />
            <div className="flex items-center gap-2 border-b border-border bg-elevated px-3 py-2">
              {(
                [
                  ['servers', `Servers (${servers.length})`],
                  ['catalog', `Catalog (${catalog.length})`],
                ] as [Mode, string][]
              ).map(([m, label]) => (
                <Button
                  key={m}
                  variant="ghost"
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`h-auto sm:h-auto rounded-lg border px-3 py-1.5 ${
                    mode === m ? 'border-brand bg-brand/10' : 'border-border'
                  }`}>
                  <span
                    className={`text-xs font-semibold ${mode === m ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                    {label}
                  </span>
                </Button>
              ))}
            </div>
          </>
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          <div className="flex items-center gap-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'servers' ? 'Search servers…' : 'Search catalog…'}
              aria-label="Search MCP"
              autoCapitalize="none"
              className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
            />
            {query ? (
              <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={18} color={dark ? '#a3a3a3' : '#555'} />
              </Button>
            ) : null}
          </div>

          {action && (
            <Card>
              <div className="flex items-center gap-2">
                <Download size={14} color={brand} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{action}</span>
                <span className={`text-[11px] font-semibold ${actionRunning ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {actionRunning ? 'running' : 'done'}
                </span>
                {!actionRunning && (
                  <Button variant="ghost" size="iconSm" aria-label="Dismiss action" onClick={() => setAction(null)}>
                    <X size={14} />
                  </Button>
                )}
              </div>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-popover p-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                {actionLog.length ? actionLog.join('\n') : 'Starting…'}
              </pre>
            </Card>
          )}

          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : mode === 'servers' ? (
            visibleServers.length === 0 ? (
              <Card>
                <div className="text-xs text-neutral-500 dark:text-neutral-400">
                  {servers.length === 0
                    ? 'No MCP servers configured. Pick one from the catalog, or add your own.'
                    : 'No matching servers.'}
                </div>
              </Card>
            ) : (
              <div className="flex flex-col gap-2">
                {visibleServers.map((s) => (
                  <ServerRow
                    key={s.name}
                    server={s}
                    dark={dark}
                    toggling={toggling === s.name}
                    testing={testing === s.name}
                    authenticating={authenticating === s.name}
                    test={tests[s.name]}
                    onToggle={toggleServer}
                    onTest={runTest}
                    onAuth={runAuth}
                    onDelete={removeServer}
                  />
                ))}
              </div>
            )
          ) : visibleCatalog.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">No matching catalog entries.</div>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {visibleCatalog.map((e) => (
                <CatalogRow key={e.name} entry={e} onInstall={openInstall} />
              ))}
            </div>
          )}
        </div>
      </ScreenScaffold>

      {addOpen && (
        <AddServerSheet
          dark={dark}
          opsMut={opsMut}
          profile={profile}
          getAuthScope={getAuthScope}
          onClose={() => setAddOpen(false)}
          onAdded={() => {
            setAddOpen(false);
            void load(true);
          }}
        />
      )}

      {installEntry && (
        <InstallSheet
          entry={installEntry}
          env={installEnv}
          setEnv={setInstallEnv}
          installing={installing}
          dark={dark}
          onClose={() => setInstallEntry(null)}
          onInstall={() => void doInstall()}
        />
      )}
    </div>
  );
}

function ServerRow({
  server,
  dark,
  toggling,
  testing,
  authenticating,
  test,
  onToggle,
  onTest,
  onAuth,
  onDelete,
}: {
  server: McpServer;
  dark: boolean;
  toggling: boolean;
  testing: boolean;
  authenticating: boolean;
  test: McpServerTestResult | undefined;
  onToggle: (s: McpServer, enabled: boolean) => void;
  onTest: (s: McpServer) => void;
  onAuth: (s: McpServer) => void;
  onDelete: (s: McpServer) => void;
}) {
  const isPlugin = server.source === 'plugin';
  return (
    <Card>
      <div className="flex items-start gap-2">
        <Server size={17} color={server.enabled ? '#0284c7' : dark ? '#666' : '#999'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{server.name}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${transportBadgeClass(server.transport)}`}>
              {server.transport}
            </span>
            {server.auth && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                {server.auth}
              </span>
            )}
            {isPlugin && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                plugin{server.plugin ? `: ${server.plugin}` : ''}
              </span>
            )}
          </div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400">
            {server.url || [server.command, ...server.args].filter(Boolean).join(' ')}
          </div>
        </div>
        {toggling ? (
          <Spinner size={14} color={brandColor(dark)} />
        ) : (
          <Switch
            checked={server.enabled}
            onCheckedChange={(v) => void onToggle(server, v)}
            aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name}`}
          />
        )}
      </div>

      {test && (
        <div className="mt-2 rounded-lg border border-border p-2">
          {test.ok ? (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400">
              OK · {test.tools.length} tools
              {test.prompts ? ` · ${test.prompts} prompts` : ''}
              {test.resources ? ` · ${test.resources} resources` : ''}
            </div>
          ) : (
            <div className="text-[11px] text-red-600 dark:text-red-400">{test.error || 'Probe failed'}</div>
          )}
          {test.tools.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {test.tools.slice(0, 12).map((t) => (
                <span
                  key={t.name}
                  className="rounded-md border border-border px-1.5 py-px font-mono text-[10px] text-neutral-500">
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-border pt-2.5">
        <Button
          variant="outline"
          aria-label={`Test ${server.name}`}
          onClick={() => void onTest(server)}
          disabled={testing}
          className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
          {testing ? <Spinner size={13} color={brandColor(dark)} /> : <Zap size={13} color={brandColor(dark)} />}
          <span className="text-xs font-semibold">Test</span>
        </Button>
        {server.auth === 'oauth' && (
          <Button
            variant="outline"
            aria-label={`Authenticate ${server.name}`}
            onClick={() => void onAuth(server)}
            disabled={authenticating}
            className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
            {authenticating ? (
              <Spinner size={13} color={brandColor(dark)} />
            ) : (
              <Shield size={13} color={brandColor(dark)} />
            )}
            <span className="text-xs font-semibold">Authenticate</span>
          </Button>
        )}
        <div className="flex-1" />
        {!isPlugin && (
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Delete ${server.name}`}
            onClick={() => void onDelete(server)}
            className="rounded-lg">
            <Trash2 size={15} color="#ef4444" />
          </Button>
        )}
      </div>
    </Card>
  );
}

function CatalogRow({ entry, onInstall }: { entry: McpCatalogEntry; onInstall: (e: McpCatalogEntry) => void }) {
  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{entry.name}</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${transportBadgeClass(entry.transport)}`}>
              {entry.transport}
            </span>
            {entry.authType !== 'none' && (
              <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-neutral-500">
                auth: {entry.authType}
              </span>
            )}
            {entry.installed && (
              <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                installed
              </span>
            )}
          </div>
          {!!entry.description && (
            <div className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
              {entry.description}
            </div>
          )}
          {entry.url && <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400">{entry.url}</div>}
        </div>
        {entry.installed ? (
          <span className="shrink-0 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-neutral-500">
            Installed
          </span>
        ) : (
          <Button
            aria-label={`Install ${entry.name}`}
            onClick={() => onInstall(entry)}
            className="h-auto sm:h-auto shrink-0 rounded-xl px-3 py-2">
            <Download size={14} color="#fff" />
            <span className="text-xs font-semibold text-white">Install</span>
          </Button>
        )}
      </div>
    </Card>
  );
}

function AddServerSheet({
  dark,
  opsMut,
  profile,
  getAuthScope,
  onClose,
  onAdded,
}: {
  dark: boolean;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  profile: string;
  getAuthScope: () => unknown;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'http' | 'stdio'>('http');
  const [url, setUrl] = useState('');
  const [httpAuth, setHttpAuth] = useState<'none' | 'oauth' | 'header'>('none');
  const [bearer, setBearer] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [env, setEnv] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    if (!name.trim()) {
      setErr('Name is required.');
      return;
    }
    if (transport === 'http' && !url.trim()) {
      setErr('URL is required for an HTTP server.');
      return;
    }
    if (transport === 'stdio' && !command.trim()) {
      setErr('Command is required for a stdio server.');
      return;
    }
    const scope = getAuthScope();
    setSaving(true);
    setErr(null);
    try {
      const envMap: Record<string, string> = {};
      for (const line of env.split('\n')) {
        const i = line.indexOf('=');
        if (i > 0) {
          const k = line.slice(0, i).trim();
          const v = line.slice(i + 1).trim();
          if (k && v) envMap[k] = v;
        }
      }
      await addMcpServer(opsMut, {
        name: name.trim(),
        ...(transport === 'http'
          ? { url: url.trim(), auth: httpAuth, ...(bearer.trim() ? { bearerToken: bearer.trim() } : {}) }
          : {
              command: command.trim(),
              args: args.trim() ? args.trim().split(/\s+/) : [],
              ...(Object.keys(envMap).length ? { env: envMap } : {}),
            }),
      });
      if (getAuthScope() !== scope) return;
      onAdded();
    } catch (e) {
      if (getAuthScope() === scope) setErr(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setSaving(false);
    }
  }, [args, bearer, command, env, getAuthScope, httpAuth, name, onAdded, opsMut, transport, url, profile]);

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Add MCP server</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Add a stdio or HTTP MCP server.</DialogPrimitive.Description>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close add server"
                onClick={onClose}
                className="h-11 w-11 shrink-0 sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1 text-sm font-bold text-neutral-900 dark:text-white">Add MCP server</div>
              <Button
                aria-label="Add server"
                onClick={() => void save()}
                disabled={saving}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {saving ? <Spinner size={14} color="#fff" /> : <Check size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Add</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              <div className="flex flex-col gap-3">
                <div>
                  <Label className="mb-1 text-xs font-semibold">Name *</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoCapitalize="none"
                    placeholder="my-server"
                    className="rounded-xl"
                  />
                </div>
                <div className="flex gap-2">
                  {(['http', 'stdio'] as const).map((t) => (
                    <Button
                      key={t}
                      variant="ghost"
                      aria-pressed={transport === t}
                      onClick={() => setTransport(t)}
                      className={`h-auto sm:h-auto flex-1 rounded-xl border px-3 py-2 ${transport === t ? 'border-brand bg-brand/10' : 'border-border'}`}>
                      <span
                        className={`text-xs font-semibold ${transport === t ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                        {t}
                      </span>
                    </Button>
                  ))}
                </div>
                {transport === 'http' ? (
                  <>
                    <div>
                      <Label className="mb-1 text-xs font-semibold">URL *</Label>
                      <Input
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        autoCapitalize="none"
                        placeholder="https://mcp.example.com/mcp"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-semibold">Auth</Label>
                      <div className="flex gap-2">
                        {(['none', 'oauth', 'header'] as const).map((a) => (
                          <Button
                            key={a}
                            variant="ghost"
                            aria-pressed={httpAuth === a}
                            onClick={() => setHttpAuth(a)}
                            className={`h-auto sm:h-auto flex-1 rounded-xl border px-2 py-2 ${httpAuth === a ? 'border-brand bg-brand/10' : 'border-border'}`}>
                            <span
                              className={`text-xs font-semibold ${httpAuth === a ? 'text-brand' : 'text-neutral-600 dark:text-neutral-300'}`}>
                              {a}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                    {httpAuth === 'header' && (
                      <div>
                        <Label className="mb-1 text-xs font-semibold">Bearer token</Label>
                        <Input
                          type="password"
                          value={bearer}
                          onChange={(e) => setBearer(e.target.value)}
                          autoCapitalize="none"
                          placeholder="token"
                          className="rounded-xl"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <Label className="mb-1 text-xs font-semibold">Command *</Label>
                      <Input
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        autoCapitalize="none"
                        placeholder="npx"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-semibold">Args (space-separated)</Label>
                      <Input
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        autoCapitalize="none"
                        placeholder="-y @modelcontextprotocol/server-filesystem /path"
                        className="rounded-xl"
                      />
                    </div>
                    <div>
                      <Label className="mb-1 text-xs font-semibold">Env (KEY=VALUE per line)</Label>
                      <textarea
                        value={env}
                        onChange={(e) => setEnv(e.target.value)}
                        spellCheck={false}
                        className="min-h-20 w-full rounded-xl border border-border px-3 py-2 font-mono text-xs text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
                      />
                    </div>
                  </>
                )}
                {err && <div className="whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</div>}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function InstallSheet({
  entry,
  env,
  setEnv,
  installing,
  dark,
  onClose,
  onInstall,
}: {
  entry: McpCatalogEntry;
  env: Record<string, string>;
  setEnv: (v: Record<string, string>) => void;
  installing: boolean;
  dark: boolean;
  onClose: () => void;
  onInstall: () => void;
}) {
  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">Install {entry.name}</DialogPrimitive.Title>
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
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-neutral-900 dark:text-white">{entry.name}</div>
                <div className="mt-0.5 text-[11px] text-neutral-400">Install from catalog</div>
              </div>
              <Button
                aria-label={`Install ${entry.name}`}
                onClick={onInstall}
                disabled={installing}
                className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                {installing ? <Spinner size={14} color="#fff" /> : <Download size={14} color="#fff" />}
                <span className="text-sm font-semibold text-white">Install</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {!!entry.description && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{entry.description}</p>
              )}
              <div className="mt-3 flex flex-col gap-2 rounded-xl border border-border p-3">
                <div className="font-mono text-[11px] text-neutral-500">transport: {entry.transport}</div>
                {entry.url && <div className="truncate font-mono text-[11px] text-neutral-500">url: {entry.url}</div>}
                {entry.command && (
                  <div className="truncate font-mono text-[11px] text-neutral-500">
                    cmd: {[entry.command, ...entry.args].join(' ')}
                  </div>
                )}
              </div>

              {entry.needsInstall && (
                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                  This entry clones and builds a git repo — it runs in the background after saving.
                </div>
              )}

              {entry.requiredEnv.length > 0 && (
                <div className="mt-3 flex flex-col gap-2.5">
                  <div className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                    Required credentials
                  </div>
                  {entry.requiredEnv.map((e) => (
                    <div key={e.name}>
                      <div className="mb-1 flex items-center gap-1.5">
                        <Label className="font-mono text-[11px]">{e.name}</Label>
                        {!e.required && <span className="text-[10px] text-neutral-400">optional</span>}
                      </div>
                      <Input
                        type="password"
                        autoCapitalize="none"
                        placeholder={e.prompt}
                        value={env[e.name] ?? ''}
                        onChange={(ev) => setEnv({ ...env, [e.name]: ev.target.value })}
                        className="rounded-xl font-mono"
                      />
                    </div>
                  ))}
                </div>
              )}
              {entry.installUrl && (
                <a
                  href={entry.installUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1 text-[11px] text-brand">
                  <ExternalLink size={11} /> {entry.installUrl}
                </a>
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
