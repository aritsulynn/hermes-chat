// System route — host stats, gateway lifecycle, credential pool, and the
// one-shot maintenance actions.
//
// Ported from the desktop `SystemPage.tsx`, scoped to the pieces that need no
// separate Config/Env screens (stats, gateway start/stop, doctor / security
// audit / backup / checkpoints prune, and the redacted credential pool).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import {
  Database,
  HardDrive,
  KeyRound,
  Play,
  RefreshCw,
  RotateCw,
  Shield,
  Square,
  Stethoscope,
} from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { errMsg } from '../../utils/messages';
import { Card, ErrorRetry, HeaderIconButton, ScreenHeader, ScreenScaffold, Spinner } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Progress } from '../../components/ui/progress';
import { toast } from '../../components/ui/toast';
import { formatBytes } from '../../utils/format';
import { brandColor, screenStyle } from '../../theme';
import * as api from '../../services/api';
import { normalizeActionStatus } from '../../services/hermes-update';
import {
  getCheckpoints,
  getCredentialPool,
  getSystemStats,
  runOpsAction,
  startGateway,
  stopGateway,
  type CheckpointsState,
  type CredentialProvider,
  type SystemStats,
} from '../../services/system';

function formatUptime(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function SystemScreen() {
  const { authed, opsGet, opsMut, getAuthScope, conn } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const brand = useMemo(() => brandColor(dark), [dark]);

  const [stats, setStats] = useState<SystemStats | null>(null);
  const [pool, setPool] = useState<CredentialProvider[]>([]);
  const [checkpoints, setCheckpoints] = useState<CheckpointsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gatewayBusy, setGatewayBusy] = useState<'start' | 'stop' | null>(null);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  // Live log for the most recent ops action.
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
        const [nextStats, nextPool, nextCps] = await Promise.all([
          getSystemStats(opsGet),
          getCredentialPool(opsGet).catch((e) => {
            console.warn('[system] credential pool unavailable', e);
            return [] as CredentialProvider[];
          }),
          getCheckpoints(opsGet).catch((e) => {
            console.warn('[system] checkpoints unavailable', e);
            return { sessions: [], totalBytes: 0 } as CheckpointsState;
          }),
        ]);
        if (getAuthScope() !== scope) return;
        setStats(nextStats);
        setPool(nextPool);
        setCheckpoints(nextCps);
      } catch (e) {
        if (getAuthScope() === scope) setError(errMsg(e));
      } finally {
        if (getAuthScope() === scope) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [getAuthScope, opsGet],
  );

  useEffect(() => {
    if (authed) void load();
  }, [authed, load]);

  // Poll a spawned ops action (doctor / audit / backup / prune).
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
      } catch {
        if (!cancelled) setActionRunning(false);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [action, getAuthScope, opsGet]);

  const runAction = useCallback(
    async (which: 'doctor' | 'security-audit' | 'backup' | 'checkpoints-prune') => {
      const scope = getAuthScope();
      setRunningAction(which);
      try {
        const name = await runOpsAction(opsMut, which);
        if (getAuthScope() !== scope) return;
        setActionLog([]);
        setActionRunning(true);
        setAction(name || which);
      } catch (e) {
        if (getAuthScope() === scope) toast({ title: 'Action failed', description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setRunningAction(null);
      }
    },
    [getAuthScope, opsMut],
  );

  const controlGateway = useCallback(
    async (verb: 'start' | 'stop') => {
      const scope = getAuthScope();
      setGatewayBusy(verb);
      try {
        if (verb === 'start') await startGateway(opsMut);
        else await stopGateway(opsMut);
        if (getAuthScope() !== scope) return;
        toast({ title: `Gateway ${verb} requested` });
        // The gateway status is polled by the store's connection state; no reload.
      } catch (e) {
        if (getAuthScope() === scope) toast({ title: `Gateway ${verb} failed`, description: errMsg(e), variant: 'destructive' });
      } finally {
        if (getAuthScope() === scope) setGatewayBusy(null);
      }
    },
    [getAuthScope, opsMut],
  );

  if (!authed) return <Redirect to="/login" replace />;

  const gatewayReady = conn === 'ready';
  const gatewayConnecting = conn === 'connecting' || conn === 'reconnecting';

  return (
    <div style={screenStyle(dark)}>
      <ScreenScaffold
        header={
          <ScreenHeader
            title="System"
            subtitle={stats ? `${stats.hostname || 'host'} · ${stats.hermesVersion || '—'}` : 'Loading…'}
            actions={
              <HeaderIconButton aria-label="Refresh system" onClick={() => void load(true)}>
                <RefreshCw size={20} color={dark ? '#e5e5e5' : '#333'} className={refreshing ? 'animate-spin' : ''} />
              </HeaderIconButton>
            }
          />
        }
        contentClassName="px-4 py-4">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
          {loading && !refreshing ? (
            <div className="flex items-center justify-center py-16">
              <Spinner size={24} color={brand} />
            </div>
          ) : error ? (
            <ErrorRetry error={error} onRetry={() => void load()} />
          ) : (
            <>
              {action && (
                <Card>
                  <div className="flex items-center gap-2">
                    <Play size={14} color={brand} />
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{action}</span>
                    <span className={`text-[11px] font-semibold ${actionRunning ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {actionRunning ? 'running' : 'done'}
                    </span>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-popover p-2 font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
                    {actionLog.length ? actionLog.join('\n') : 'Starting…'}
                  </pre>
                </Card>
              )}

              {/* Host */}
              {stats && (
                <Card>
                  <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Host</div>
                  <div className="mt-2 flex flex-col gap-1.5 text-xs">
                    <Row label="OS" value={stats.platformLabel || stats.os} />
                    <Row label="Arch" value={stats.arch} />
                    <Row label="Host" value={stats.hostname} />
                    <Row label="Python" value={stats.pythonVersion} />
                    <Row label="Hermes" value={stats.hermesVersion} />
                    <Row label="CPU" value={`${stats.cpuCount} cores${stats.cpuPercent != null ? ` · ${stats.cpuPercent}%` : ''}`} />
                    <Row label="Uptime" value={formatUptime(stats.uptimeSeconds)} />
                    {stats.process && (
                      <Row label="Process" value={`pid ${stats.process.pid} · ${stats.process.threads} threads`} />
                    )}
                  </div>

                  {stats.memory && (
                    <div className="mt-3 border-t border-border pt-3">
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-neutral-600 dark:text-neutral-300">Memory</span>
                        <span className="font-mono text-neutral-900 dark:text-neutral-100">
                          {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)} ({stats.memory.percent}%)
                        </span>
                      </div>
                      <Progress value={stats.memory.percent} indicatorClassName="bg-brand" className="bg-border" />
                    </div>
                  )}
                  {stats.disk && (
                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="text-neutral-600 dark:text-neutral-300">Disk</span>
                        <span className="font-mono text-neutral-900 dark:text-neutral-100">
                          {formatBytes(stats.disk.used)} / {formatBytes(stats.disk.total)} ({stats.disk.percent}%)
                        </span>
                      </div>
                      <Progress value={stats.disk.percent} indicatorClassName="bg-[#f59e0b]" className="bg-border" />
                    </div>
                  )}
                </Card>
              )}

              {/* Gateway */}
              <Card>
                <div className="flex items-center gap-2">
                  <Database size={15} color={brand} />
                  <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Gateway</div>
                  <span
                    className={`ml-auto text-[11px] font-semibold ${
                      gatewayReady ? 'text-emerald-600 dark:text-emerald-400' : gatewayConnecting ? 'text-amber-600' : 'text-red-500'
                    }`}>
                    {gatewayReady ? 'Connected' : gatewayConnecting ? 'Connecting…' : 'Disconnected'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    aria-label="Start gateway"
                    onClick={() => void controlGateway('start')}
                    disabled={gatewayBusy !== null || gatewayReady}
                    className="h-auto sm:h-auto rounded-xl px-3 py-2">
                    {gatewayBusy === 'start' ? <Spinner size={13} color="#fff" /> : <Play size={13} color="#fff" />}
                    <span className="text-xs font-semibold text-white">Start</span>
                  </Button>
                  <Button
                    variant="outline"
                    aria-label="Stop gateway"
                    onClick={() => void controlGateway('stop')}
                    disabled={gatewayBusy !== null || !gatewayReady}
                    className="h-auto sm:h-auto rounded-xl px-3 py-2">
                    {gatewayBusy === 'stop' ? <Spinner size={13} color={brand} /> : <Square size={13} color={brand} />}
                    <span className="text-xs font-semibold">Stop</span>
                  </Button>
                </div>
              </Card>

              {/* Credential pool */}
              <Card>
                <div className="flex items-center gap-2">
                  <KeyRound size={15} color={brand} />
                  <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Credential pool</div>
                </div>
                {pool.length === 0 ? (
                  <div className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">No pooled credentials.</div>
                ) : (
                  <div className="mt-2 flex flex-col gap-2">
                    {pool.map((p) => (
                      <div key={p.provider} className="rounded-xl border border-border p-2.5">
                        <div className="font-mono text-xs font-semibold uppercase text-neutral-700 dark:text-neutral-300">
                          {p.provider}
                        </div>
                        {p.entries.map((e, i) => (
                          <div key={i} className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-neutral-500 dark:text-neutral-400">
                              {e.label || e.source || 'key'}
                            </span>
                            <span className="shrink-0 font-mono text-neutral-400">
                              {e.masked || '••••'}
                              {e.status ? ` · ${e.status}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Maintenance */}
              <Card>
                <div className="flex items-center gap-2">
                  <Shield size={15} color={brand} />
                  <div className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Maintenance</div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <ActionButton icon={<Stethoscope size={13} color="#fff" />} label="Run doctor" busy={runningAction === 'doctor'} onClick={() => void runAction('doctor')} primary />
                  <ActionButton icon={<Shield size={13} />} label="Security audit" busy={runningAction === 'security-audit'} onClick={() => void runAction('security-audit')} />
                  <ActionButton icon={<HardDrive size={13} />} label="Create backup" busy={runningAction === 'backup'} onClick={() => void runAction('backup')} />
                  <ActionButton
                    icon={<RotateCw size={13} />}
                    label="Prune checkpoints"
                    busy={runningAction === 'checkpoints-prune'}
                    onClick={() => void runAction('checkpoints-prune')}
                  />
                </div>
                {checkpoints && (
                  <div className="mt-3 border-t border-border pt-3 text-[11px] text-neutral-500 dark:text-neutral-400">
                    Checkpoints: {checkpoints.sessions.length} session(s) · {formatBytes(checkpoints.totalBytes)}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </ScreenScaffold>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-neutral-600 dark:text-neutral-300">{label}</span>
      <span className="truncate text-right font-mono text-neutral-900 dark:text-neutral-100">{value || '—'}</span>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  busy,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <Button
      variant={primary ? 'default' : 'outline'}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      className="h-auto sm:h-auto rounded-xl px-3 py-2">
      {busy ? <Spinner size={13} color={primary ? '#fff' : '#888'} /> : icon}
      <span className={`text-xs font-semibold ${primary ? 'text-white' : ''}`}>{label}</span>
    </Button>
  );
}
