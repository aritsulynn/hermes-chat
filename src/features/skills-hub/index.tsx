// Skills Hub — search, preview, security-scan and install skills from the
// connected hub sources (GitHub, the Hermes index, community).
//
// Ported from Hermes Desktop's `SkillsPage.tsx` HubBrowser ("Browse hub" tab),
// re-skinned for mobile and split into its own route so the installed-skills
// screen stays a plain inventory. Install/update spawn a background action
// (`/api/actions/{name}/status`) exactly like the desktop, so progress is
// polled and the installed-state badges refresh when the process exits.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Download, RefreshCw, Search, Shield, ShieldAlert, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { useOpsMutation, useOpsQuery } from '../../store/ops-query';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Badge } from '../../components/ui/badge';
import { toast } from '../../components/ui/toast';
import { brandColor, screenStyle } from '../../theme';
import * as api from '../../services/api';
import { normalizeActionStatus } from '../../services/hermes-update';
import {
  getSkillHubSources,
  installSkillHub,
  previewSkillHub,
  scanSkillHub,
  searchSkillHub,
  updateSkillsHub,
  type SkillHubPreview,
  type SkillHubSearchResult,
  type SkillHubSources,
  type SkillHubResult,
  type SkillHubScan,
  type SkillHubSource,
} from '../../services/skills';

const LOG_LINES = 200;
const POLL_MS = 1200;

// Stable empty values, so the `??`s below do not hand a memo a fresh array or
// object on every render while a query is still pending.
const NO_SOURCES: SkillHubSource[] = [];
const NO_RESULTS: SkillHubResult[] = [];
const NO_LOG: string[] = [];

function trustBadgeClass(level: string): string {
  switch (level) {
    case 'trusted':
      return 'border-emerald-300 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
    case 'builtin':
      return 'border-sky-300 bg-sky-100 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300';
    case 'community':
      return 'border-amber-300 bg-amber-100 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
    default:
      return 'border-border bg-muted text-neutral-600 dark:text-neutral-300';
  }
}

function verdictVisual(verdict: string): { className: string; label: string; Icon: typeof ShieldCheck } {
  switch (verdict) {
    case 'safe':
      return { className: 'text-emerald-600 dark:text-emerald-400', label: 'Safe', Icon: ShieldCheck };
    case 'caution':
      return { className: 'text-amber-600 dark:text-amber-400', label: 'Caution', Icon: ShieldAlert };
    case 'dangerous':
      return { className: 'text-red-600 dark:text-red-400', label: 'Dangerous', Icon: ShieldAlert };
    default:
      return { className: 'text-neutral-500', label: verdict || 'Unknown', Icon: Shield };
  }
}

export function SkillsHubScreen() {
  const { authed, opsGet, activeProfile } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [query, setQuery] = useState('');
  // `query` is the input, `applied` is the search the server was last asked for.
  // Submit-driven, so the key tracks the applied term and typing does not search.
  const [applied, setApplied] = useState('');

  // Live action log for the most recent install/update. Only the id is state.
  const [action, setAction] = useState<string | null>(null);

  const [detail, setDetail] = useState<SkillHubResult | null>(null);

  const profile = activeProfile || undefined;

  // Sources + featured. The old load swallowed a failure here on purpose — leave
  // the landing minimal and let search still work — so this query's error is
  // deliberately not rendered.
  const sourcesQ = useOpsQuery<SkillHubSources>({
    key: ['skills-hub', 'sources', profile],
    get: (get) => getSkillHubSources(get, profile),
    enabled: authed,
  });
  const sources = sourcesQ.data?.sources ?? NO_SOURCES;
  const featured = sourcesQ.data?.featured ?? NO_RESULTS;
  const sourcesLoading = sourcesQ.isPending;

  const searchQ = useOpsQuery<SkillHubSearchResult>({
    key: ['skills-hub', 'search', profile, applied],
    get: (get) => searchSkillHub(get, applied, { profile }),
    enabled: authed && !!applied,
  });
  const results = searchQ.data?.results ?? NO_RESULTS;
  // A disabled query stays `pending` forever, so the flag needs the applied term.
  const searching = !!applied && searchQ.isPending;
  const searchError = searchQ.error ? errMsg(searchQ.error) : null;

  // A search reports installed state for the rows it returned, on top of what the
  // sources probe knew.
  const installed = { ...(sourcesQ.data?.installed ?? {}), ...(searchQ.data?.installed ?? {}) };

  // The poll fetches once on mount, then only while the action is still running.
  // `running !== true` matches how `normalizeActionStatus` reads the field; the
  // two have to agree or this would keep polling a payload that renders as done.
  const actionQ = useOpsQuery({
    key: ['skills-hub', 'action', action],
    get: (get) => get(api.actionStatus(String(action), LOG_LINES)),
    select: normalizeActionStatus,
    enabled: !!action && authed,
    refetchInterval: (q) => {
      const raw = q.state.data as { running?: unknown } | undefined;
      const finished = raw != null && raw.running !== true;
      return q.state.error || finished ? false : POLL_MS;
    },
  });
  const actionLog = actionQ.data?.lines ?? NO_LOG;
  // No data and no error yet is the first poll still in flight — "Starting…".
  const actionRunning = !!action && (actionQ.data ? actionQ.data.running : !actionQ.error);
  const actionFinished = !!actionQ.data && !actionQ.data.running;

  // Installed-state has to come from the server once the action exits, and the
  // poll's last tick is the only thing that knows it did. Keyed on the boolean so
  // it fires once per action — the rule wants `sourcesQ` in the deps, and that is
  // a new object every render, so this would refetch in a loop.
  useEffect(() => {
    if (actionFinished) void sourcesQ.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFinished]);

  const runSearch = () => {
    const q = query.trim();
    if (q) setApplied(q);
  };

  const install = useOpsMutation<string, string>({
    mutationFn: (mut, identifier) => installSkillHub(mut, identifier, profile),
    onSuccess: (name, identifier) => {
      toast({ title: 'Installing skill', description: identifier });
      setAction(name || `skills-install-${identifier}`);
      setDetail(null);
    },
    onError: (e) => toast({ title: 'Install failed', description: errMsg(e), variant: 'destructive' }),
  });

  const updateAll = useOpsMutation<string, void>({
    mutationFn: (mut) => updateSkillsHub(mut, profile),
    onSuccess: (name) => {
      toast({ title: 'Updating installed skills' });
      setAction(name || 'skills-update');
    },
    onError: (e) => toast({ title: 'Update failed', description: errMsg(e), variant: 'destructive' }),
  });

  const isInstalled = (identifier: string) => Boolean(installed[identifier]);
  const showLanding = !applied && !searching;
  const list = showLanding ? featured : results;

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="Skills Hub"
            subtitle={showLanding ? 'Featured & connected sources' : `${results.length} result(s)`}
            actions={
              <div className="flex items-center gap-1">
                <HeaderIconButton aria-label="Update installed skills" onClick={() => updateAll.mutate()}>
                  <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} />
                </HeaderIconButton>
              </div>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {/* Search bar */}
          <div className="flex items-center gap-1.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch();
              }}
              placeholder="Search the skill hub…"
              aria-label="Search the skill hub"
              autoCapitalize="none"
              className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-neutral-950 dark:text-neutral-100"
            />
            {query ? (
              <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQuery('')}>
                <X size={18} color={dark ? '#a3a3a3' : '#555'} />
              </Button>
            ) : null}
            <Button
              aria-label="Search hub"
              onClick={() => runSearch()}
              disabled={searching || !query.trim()}
              className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
              {searching ? <Spinner size={14} color="#fff" /> : <Search size={16} color="#fff" />}
              <span className="text-sm font-semibold text-white">Search</span>
            </Button>
          </div>

          {/* Connected hubs strip */}
          {!sourcesLoading && sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {sources.map((s) => {
                const down =
                  (s.id === 'hermes-index' && s.available === false) || (s.id === 'github' && s.rate_limited === true);
                return (
                  <Badge key={s.id} variant="secondary" className={`rounded-md ${down ? 'opacity-60' : ''}`}>
                    <span className="text-[11px] text-neutral-600 dark:text-neutral-300">
                      {s.label}
                      {s.id === 'github' && s.rate_limited ? ' (rate-limited)' : ''}
                    </span>
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Action log */}
          {action && (
            <Card>
              <div className="flex items-center gap-2">
                <Download size={14} color={brand} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-neutral-700 dark:text-neutral-300">
                  {action}
                </span>
                <span className={`text-[11px] font-semibold ${actionRunning ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {actionRunning ? 'running' : 'done'}
                </span>
                {!actionRunning && (
                  <Button variant="ghost" size="iconSm" aria-label="Dismiss action" onClick={() => setAction(null)}>
                    <X size={14} />
                  </Button>
                )}
              </div>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-popover p-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                {actionLog.length ? actionLog.join('\n') : 'Starting…'}
              </pre>
            </Card>
          )}

          {/* Error */}
          {searchError && <ErrorRetry error={searchError} onRetry={() => void runSearch()} />}

          {/* Loading */}
          {sourcesLoading && showLanding ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : list.length === 0 ? (
            <Card>
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {showLanding
                  ? 'Search the hub to browse installable skills from the connected sources.'
                  : 'No matching skills found in the hub.'}
              </div>
            </Card>
          ) : (
            <div className="flex flex-col gap-2">
              {showLanding && (
                <div className="flex items-center gap-1.5 px-1">
                  <Sparkles size={13} color={brand} />
                  <span className="text-xs font-semibold text-neutral-600 dark:text-neutral-300">Featured skills</span>
                </div>
              )}
              {list.map((r) => (
                <HubRow
                  key={r.identifier}
                  result={r}
                  installed={isInstalled(r.identifier)}
                  onOpen={() => setDetail(r)}
                  onInstall={() => install.mutate(r.identifier)}
                />
              ))}
            </div>
          )}
        </div>
      </ScreenScaffold>

      {detail && (
        <SkillDetail
          result={detail}
          installed={isInstalled(detail.identifier)}
          opsGet={opsGet}
          onClose={() => setDetail(null)}
          onInstall={() => install.mutate(detail.identifier)}
        />
      )}
    </div>
  );
}

function HubRow({
  result,
  installed,
  onOpen,
  onInstall,
}: {
  result: SkillHubResult;
  installed: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  return (
    <Card>
      <div className="flex items-start gap-2">
        <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={onOpen}>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {result.name}
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${trustBadgeClass(result.trust_level)}`}>
              {result.trust_level}
            </span>
            {installed && (
              <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                installed
              </span>
            )}
          </span>
          {!!result.description && (
            <span className="mt-0.5 line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
              {result.description}
            </span>
          )}
          <span className="mt-1 truncate font-mono text-[11px] text-neutral-400">{result.identifier}</span>
        </button>
        <div className="shrink-0">
          {installed ? (
            <Button variant="ghost" disabled className="h-auto sm:h-auto rounded-xl border border-border px-3 py-2">
              <span className="text-xs font-semibold text-neutral-500">Installed</span>
            </Button>
          ) : (
            <Button
              aria-label={`Install ${result.name}`}
              onClick={onInstall}
              className="h-auto sm:h-auto rounded-xl px-3 py-2">
              <Download size={14} color="#fff" />
              <span className="text-xs font-semibold text-white">Install</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function SkillDetail({
  result,
  installed,
  opsGet,
  onClose,
  onInstall,
}: {
  result: SkillHubResult;
  installed: boolean;
  opsGet: (path: string) => Promise<unknown>;
  onClose: () => void;
  onInstall: () => void;
}) {
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);
  const [tab, setTab] = useState<'readme' | 'scan'>('readme');
  const [preview, setPreview] = useState<SkillHubPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [scan, setScan] = useState<SkillHubScan | null>(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    previewSkillHub(opsGet, result.identifier)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => {})
      .finally(() => !cancelled && setPreviewLoading(false));
    return () => {
      cancelled = true;
    };
  }, [opsGet, result.identifier]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setTab('scan');
    try {
      const s = await scanSkillHub(opsGet, result.identifier);
      setScan(s);
    } catch (e) {
      toast({ title: 'Scan failed', description: errMsg(e), variant: 'destructive' });
    } finally {
      setScanning(false);
    }
  }, [opsGet, result.identifier]);

  const verdict = scan ? verdictVisual(scan.verdict) : null;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">{result.name}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Preview the SKILL.md and run a security scan before installing.
          </DialogPrimitive.Description>
          <div className="flex min-h-0 flex-1 flex-col" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close skill detail"
                onClick={onClose}
                className="h-11 w-11 shrink-0 rounded-md sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm font-bold text-neutral-900 dark:text-white">
                  {result.name}
                </div>
                <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-400">{result.identifier}</div>
              </div>
              {installed ? (
                <span className="shrink-0 rounded-xl border border-border px-3 py-2 text-xs font-semibold text-neutral-500">
                  Installed
                </span>
              ) : (
                <Button
                  aria-label={`Install ${result.name}`}
                  onClick={onInstall}
                  className="h-auto sm:h-auto shrink-0 rounded-xl px-4 py-2.5">
                  <Download size={14} color="#fff" />
                  <span className="text-sm font-semibold text-white">Install</span>
                </Button>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              {!!result.description && (
                <p className="text-xs text-neutral-500 dark:text-neutral-400">{result.description}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2 border-y border-border py-2.5">
                <Button
                  variant={tab === 'readme' ? 'default' : 'outline'}
                  onClick={() => setTab('readme')}
                  className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                  <span
                    className={`text-xs font-semibold ${tab === 'readme' ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'}`}>
                    SKILL.md
                  </span>
                </Button>
                <Button
                  variant={tab === 'scan' ? 'default' : 'outline'}
                  aria-label="Security scan"
                  onClick={() => void runScan()}
                  disabled={scanning}
                  className="h-auto sm:h-auto rounded-lg px-3 py-1.5">
                  <Shield size={13} color={tab === 'scan' ? '#fff' : brand} />
                  <span
                    className={`text-xs font-semibold ${tab === 'scan' ? 'text-white' : 'text-neutral-700 dark:text-neutral-300'}`}>
                    {scanning ? 'Scanning…' : scan ? 'Re-scan' : 'Security scan'}
                  </span>
                </Button>
              </div>

              {tab === 'readme' ? (
                previewLoading ? (
                  <div className="flex items-center justify-center py-16">
                    <Spinner size={20} color={brand} />
                  </div>
                ) : preview ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {preview.files.length > 0 && (
                      <div className="text-[11px] text-neutral-400">
                        Files: <span className="font-mono">{preview.files.join('  ')}</span>
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-popover p-3 font-mono text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                      {preview.skillMd.trim() || '(SKILL.md is empty)'}
                    </pre>
                  </div>
                ) : (
                  <p className="py-10 text-center text-sm text-neutral-500">Couldn't load the skill source.</p>
                )
              ) : (
                <ScanPanel scan={scan} scanning={scanning} brand={brand} verdict={verdict} />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ScanPanel({
  scan,
  scanning,
  brand,
  verdict,
}: {
  scan: SkillHubScan | null;
  scanning: boolean;
  brand: string;
  verdict: { className: string; label: string; Icon: typeof ShieldCheck } | null;
}) {
  if (scanning && !scan) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16">
        <Spinner size={24} color={brand} />
        <span className="text-xs text-neutral-500">Fetching, quarantining and scanning…</span>
      </div>
    );
  }
  if (!scan) {
    return (
      <p className="py-10 text-center text-sm text-neutral-500">
        Run a security scan to inspect this skill before installing.
      </p>
    );
  }
  const Icon = verdict?.Icon ?? Shield;
  return (
    <div className="mt-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon size={18} className={verdict?.className} />
        <span className={`text-sm font-bold ${verdict?.className}`}>{verdict?.label}</span>
        <span className="text-[11px] text-neutral-400">
          policy: {scan.policy}
          {scan.policyReason ? ` · ${scan.policyReason}` : ''}
        </span>
      </div>
      {!!scan.summary && <p className="text-xs text-neutral-500 dark:text-neutral-400">{scan.summary}</p>}
      {scan.findings.length === 0 ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">No risky patterns found.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {scan.findings.map((f, i) => (
            <div
              key={`${f.severity}-${f.file ?? ''}-${f.line ?? ''}-${i}`}
              className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase text-neutral-500">{f.severity}</span>
                {f.category && <span className="text-[10px] text-neutral-400">{f.category}</span>}
              </div>
              <div className="mt-0.5 text-xs text-neutral-700 dark:text-neutral-300">{f.description}</div>
              {(f.file || f.line != null) && (
                <div className="mt-0.5 font-mono text-[10px] text-neutral-400">
                  {f.file}
                  {f.line != null ? `:${f.line}` : ''}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
