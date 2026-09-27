// Settings → About: Hermes **server** update panel.
//
// Mirrors the dashboard's System page update controls, but native:
//   check → apply (with confirm) → live-stream the action log until the
//   background `hermes update` exits → read the durable receipt.
//
// The dashboard restarts itself as part of an update, so the status poll
// tolerates a run of failures (reconnecting) instead of declaring failure on
// the first dropped request. See src/services/hermes-update.ts for the parsing.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  Text,
  View,
} from 'react-native';
import {
  ArrowDown,
  ChevronDown,
  ChevronUp,
  Download,
  RefreshCw,
  RotateCw,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { asRecord } from '../../utils/ops';
import { errMsg } from '../../utils/messages';
import { Button } from './button';
import { Badge } from './badge';
import { Alert as UIAlert, AlertDescription } from './alert';
import { Text as UIText } from './text';
import { ConfirmDialog } from './dialog';
import * as api from '../../services/api';
import {
  actionOutcomeLabel,
  actionOutcomeTone,
  normalizeActionStatus,
  normalizeReceiptSummary,
  normalizeUpdateCheck,
  receiptOutcomeLabel,
  receiptOutcomeTone,
  updateStatusLabel,
  updateStatusTone,
  type UpdateCheck,
  type UpdateReceiptSummary,
  type UpdateTone,
} from '../../services/hermes-update';

const UPDATE_ACTION = 'hermes-update';
const LOG_LINES = 400;
const POLL_MS = 1200;
/** ~30s of tolerance for the dashboard restarting itself mid-update. */
const MAX_POLL_ERRORS = 20;

// NativeWind classes per tone, light + dark.
const CHIP: Record<UpdateTone, string> = {
  success:
    'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
  warning:
    'border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
  danger:
    'border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40',
  muted:
    'border-neutral-300 bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800',
};
const CHIP_TEXT: Record<UpdateTone, string> = {
  success: 'text-emerald-700 dark:text-emerald-300',
  warning: 'text-amber-700 dark:text-amber-300',
  danger: 'text-red-700 dark:text-red-300',
  muted: 'text-neutral-600 dark:text-neutral-300',
};

function Chip({ tone, label }: { tone: UpdateTone; label: string }) {
  const variant = tone === 'danger' ? 'destructive' : tone === 'muted' ? 'secondary' : 'outline';
  return (
    <Badge variant={variant} className={CHIP[tone]}>
      <UIText className={`text-[11px] font-semibold ${CHIP_TEXT[tone]}`}>{label}</UIText>
    </Badge>
  );
}

function formatCommitDate(at: number): string {
  if (!at) return '';
  try {
    // `at` may be seconds or milliseconds — normalize to ms.
    const ms = at > 1e12 ? at : at * 1000;
    return new Date(ms).toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function UpdatePanel() {
  const { conn, activeProfile, opsGet, opsMut, getAuthScope } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';

  const [info, setInfo] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
// Themed replacement for the old Alert.alert confirms.
const [confirm, setConfirm] = useState<{
  title: string;
  body: string;
  confirmLabel: string;
  run: () => void;
} | null>(null);
  const [receipt, setReceipt] = useState<UpdateReceiptSummary | null>(null);
  const [note, setNote] = useState('');
  // While true, new log lines keep the view pinned to the bottom. The user
  // scrolling up turns it off so reading earlier output isn't yanked away.
  const [atBottom, setAtBottom] = useState(true);
  // Commit list expander — collapsed shows the first 5 one-liners, expanded
  // shows every commit with full summary + author/date.
  const [commitsOpen, setCommitsOpen] = useState(false);

  const aliveRef = useRef(true);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logRef = useRef<ScrollView | null>(null);
  const atBottomRef = useRef(true);

  const ready = conn === 'ready';

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const setFollow = useCallback((v: boolean) => {
    if (atBottomRef.current !== v) {
      atBottomRef.current = v;
      setAtBottom(v);
    }
  }, []);

  const onLogScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const nearBottom =
        contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
      setFollow(nearBottom);
    },
    [setFollow],
  );

  const jumpToLatest = useCallback(() => {
    setFollow(true);
    logRef.current?.scrollToEnd({ animated: true });
  }, [setFollow]);

  const refresh = useCallback(
    async (force: boolean) => {
      setChecking(true);
      setError('');
      try {
        const raw = await opsGet(api.updateCheck({ force, profile: activeProfile }));
        setInfo(normalizeUpdateCheck(raw));
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setChecking(false);
      }
    },
    [activeProfile, opsGet],
  );

  const finish = useCallback(
    (name: string) => {
      if (name !== UPDATE_ACTION) return;
      const scope = getAuthScope();
      // The receipt is the durable truth across the update's own restart gap.
      // Give the updater a beat to write it before reading.
      setTimeout(() => {
        if (!aliveRef.current || getAuthScope() !== scope) return;
        opsGet(api.updateReceipt())
          .then((r) => {
            if (!aliveRef.current || getAuthScope() !== scope) return;
            const summary = normalizeReceiptSummary(asRecord(r).summary);
            if (summary) setReceipt(summary);
          })
          .catch(() => {});
      }, 900);
      // Re-check once the gateway is back so the version/status row is fresh.
      setTimeout(() => {
        if (aliveRef.current && getAuthScope() === scope) void refresh(false);
      }, 2500);
    },
    [getAuthScope, opsGet, refresh],
  );

  /** Adopt a spawned action and stream its log until the process exits. */
  const beginStream = useCallback(
    (name: string) => {
      stopPolling();
      const scope = getAuthScope();
      setActiveAction(name);
      setLines([]);
      setRunning(true);
      setExitCode(null);
      setReceipt(null);
      setNote('');
      setError('');
      setFollow(true);
      let errorStreak = 0;

      const tick = async () => {
        if (!aliveRef.current || getAuthScope() !== scope) return;
        try {
          const raw = await opsGet(api.actionStatus(name, LOG_LINES));
          if (!aliveRef.current || getAuthScope() !== scope) return;
          errorStreak = 0;
          setNote('');
          const st = normalizeActionStatus(raw);
          setLines(st.lines);
          setRunning(st.running);
          setExitCode(st.exitCode);
          if (st.running) {
            pollRef.current = setTimeout(tick, POLL_MS);
          } else {
            finish(name);
          }
        } catch (e) {
          if (!aliveRef.current || getAuthScope() !== scope) return;
          errorStreak += 1;
          if (errorStreak <= MAX_POLL_ERRORS) {
            setNote('Reconnecting to the dashboard…');
            pollRef.current = setTimeout(tick, POLL_MS + 300);
            return;
          }
          setRunning(false);
          setNote(errMsg(e));
          finish(name);
        }
      };
      void tick();
    },
    [finish, getAuthScope, opsGet, setFollow, stopPolling],
  );

  // Initial (cached) check + adopt an update that was already running when the
  // app opened (e.g. reopened mid-update).
  useEffect(() => {
    if (!ready) return;
    void refresh(false);
    let cancelled = false;
    (async () => {
      try {
        const raw = await opsGet(api.actionStatus(UPDATE_ACTION, LOG_LINES));
        if (cancelled || !aliveRef.current) return;
        const st = normalizeActionStatus(raw);
        if (st.running) beginStream(UPDATE_ACTION);
      } catch {
        // Best-effort: no prior action log is normal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, refresh, opsGet, beginStream]);

  useEffect(
    () => () => {
      aliveRef.current = false;
      stopPolling();
    },
    [stopPolling],
  );

  const runUpdate = useCallback(async () => {
    setStarting(true);
    setError('');
    try {
      const res = asRecord(await opsMut(api.updateApply(), 'POST', {}));
      if (res && res.ok === false) {
        setError(String(res.message || 'Updates are managed outside this dashboard.'));
        return;
      }
      beginStream(typeof res.name === 'string' && res.name ? res.name : UPDATE_ACTION);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setStarting(false);
    }
  }, [beginStream, opsMut]);

  const applyUpdate = useCallback(() => {
    const cmd = info?.updateCommand || 'hermes update';
    const behind = info?.behind ?? null;
    const body =
      behind && behind > 0
        ? `This runs \`${cmd}\` and pulls ${behind} new commit${behind === 1 ? '' : 's'}. The gateway restarts when the update finishes.`
        : `This runs \`${cmd}\` and restarts the gateway when it finishes.`;
    setConfirm({
      title: 'Update Hermes?',
      body,
      confirmLabel: 'Update now',
      run: () => void runUpdate(),
    });
  }, [info, runUpdate]);

  const runRestart = useCallback(async () => {
    try {
      const res = asRecord(await opsMut(api.gatewayRestart(), 'POST', {}));
      beginStream(typeof res.name === 'string' && res.name ? res.name : 'gateway-restart');
    } catch (e) {
      setError(errMsg(e));
    }
  }, [beginStream, opsMut]);

  const restartGateway = useCallback(() => {
    setConfirm({
      title: 'Restart gateway?',
      body: 'The gateway restarts and reconnects in a few seconds.',
      confirmLabel: 'Restart',
      run: () => void runRestart(),
    });
  }, [runRestart]);

  const busy = checking || starting;
  const canApply = !!info?.updateAvailable && info.canApply;
  const receiptLabel = receiptOutcomeLabel(receipt);

  return (
    <View className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-4 dark:border-neutral-800 dark:bg-neutral-900/60">
      <View className="flex-row items-start justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            Hermes Update
          </Text>
          <Text className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {info?.currentVersion ? `Version ${info.currentVersion}` : 'Check for a new server version'}
            {info && info.installMethod && info.installMethod !== 'unknown'
              ? ` · ${info.installMethod}`
              : ''}
          </Text>
        </View>
        <Chip tone={updateStatusTone(info)} label={updateStatusLabel(info)} />
      </View>

      {!!error && (
        <UIAlert icon={TriangleAlert} variant="destructive" className="mt-2">
          <AlertDescription className="text-xs text-red-600 dark:text-red-400">{error}</AlertDescription>
        </UIAlert>
      )}

      {info && info.updateAvailable && info.commits.length > 0 && (
        <View className="mt-3">
          <Button
            accessibilityRole="button"
            accessibilityLabel={commitsOpen ? 'Collapse commits' : 'Expand commits'}
            onPress={() => setCommitsOpen((v) => !v)}
            variant="ghost"
            className="flex-row items-center gap-1.5 self-start px-0 py-1"
          >
            <UIText className="text-[12px] font-semibold text-neutral-500 dark:text-neutral-400">
              {info.commits.length} commit{info.commits.length === 1 ? '' : 's'} behind
            </UIText>
            {commitsOpen ? (
              <ChevronUp size={14} color="#888" />
            ) : (
              <ChevronDown size={14} color="#888" />
            )}
          </Button>
          <View className="gap-1.5">
            {(commitsOpen ? info.commits : info.commits.slice(0, 5)).map((c, i) => (
              <View key={`${c.sha}-${i}`} className="flex-row items-start gap-2">
                <Text className="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">
                  {(c.sha || '·').slice(0, 7)}
                </Text>
                <View className="min-w-0 flex-1">
                  <Text
                    numberOfLines={commitsOpen ? undefined : 1}
                    className="text-[11px] text-neutral-600 dark:text-neutral-300"
                  >
                    {c.summary || '(no summary)'}
                  </Text>
                  {commitsOpen && (!!c.author || !!c.at) && (
                    <Text className="mt-0.5 text-[10px] text-neutral-400 dark:text-neutral-500">
                      {[c.author, formatCommitDate(c.at)].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {info && !info.canApply && info.message && (
        <UIAlert
          icon={TriangleAlert}
          variant="default"
          iconClassName="text-amber-600"
          className="mt-3 border-amber-300/70 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/30"
        >
          <AlertDescription className="text-[11px] text-amber-800 dark:text-amber-300">
            {info.message}
            {info.updateCommand ? `\n${info.updateCommand}` : ''}
          </AlertDescription>
        </UIAlert>
      )}

      {receiptLabel ? (
        <View className="mt-3">
          <Chip tone={receiptOutcomeTone(receipt)} label={receiptLabel} />
          {receipt?.finishedAt ? (
            <Text className="mt-1.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              Finished {receipt.finishedAt}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View className="mt-3 gap-2">
        <View className="flex-row items-stretch gap-2">
          <Button
            accessibilityRole="button"
            accessibilityLabel="Check for updates"
            disabled={busy || !ready}
            onPress={() => void refresh(true)}
            variant="outline"
            className="min-w-0 flex-1 shrink gap-1.5 rounded-xl px-3 py-2"
          >
            {checking ? (
              <ActivityIndicator size="small" />
            ) : (
              <RefreshCw size={14} color="#1a73e8" />
            )}
            <UIText numberOfLines={1} className="shrink text-[13px] font-semibold">
              Check for updates
            </UIText>
          </Button>

          {canApply && (
            <Button
              accessibilityRole="button"
              accessibilityLabel="Update Hermes now"
              disabled={starting || running}
              onPress={applyUpdate}
              variant="default"
              className="min-w-0 flex-1 shrink gap-1.5 rounded-xl px-3 py-2"
            >
              {starting ? (
                <ActivityIndicator size="small" color={dark ? '#111' : '#fff'} />
              ) : (
                <Download size={14} color={dark ? '#111' : '#fff'} />
              )}
              <UIText numberOfLines={1} className="shrink text-[13px] font-semibold">Update now</UIText>
            </Button>
          )}
        </View>

        <Button
          accessibilityRole="button"
          accessibilityLabel="Restart gateway"
          disabled={!ready || running}
          onPress={restartGateway}
          variant="outline"
          className="gap-1.5 self-stretch rounded-xl px-3 py-2"
        >
          <RotateCw size={14} color="#666" />
          <UIText numberOfLines={1} className="shrink text-[13px] font-semibold">
            Restart gateway
          </UIText>
        </Button>
      </View>

      {activeAction && (
        <View
          className="mt-3 overflow-hidden rounded-xl border border-neutral-800 bg-[#0f1115]"
          style={{ maxHeight: 280 }}
        >
          <View className="flex-row items-center justify-between border-b border-neutral-700/60 px-3 py-2">
            <View className="min-w-0 flex-1 flex-row items-center gap-2">
              <Terminal size={13} color="#9aa0a6" />
              <Text numberOfLines={1} className="font-mono text-[11px] text-neutral-200">
                {activeAction}
              </Text>
              <Chip tone={actionOutcomeTone(running, exitCode)} label={actionOutcomeLabel(running, exitCode)} />
            </View>
            <Button
              accessibilityRole="button"
              accessibilityLabel="Close update log"
              onPress={() => {
                stopPolling();
                setActiveAction(null);
              }}
              hitSlop={8}
              variant="ghost"
              size="icon"
              className="h-auto w-auto p-1.5"
            >
              <X size={14} color="#9aa0a6" />
            </Button>
          </View>
          <ScrollView
            ref={logRef}
            nestedScrollEnabled
            scrollEventThrottle={16}
            onScroll={onLogScroll}
            style={{ maxHeight: 230 }}
            contentContainerStyle={{ padding: 10, paddingBottom: 28 }}
            onContentSizeChange={() => {
              // Only pin to the tail while the user is already at the bottom.
              if (atBottomRef.current) logRef.current?.scrollToEnd({ animated: false });
            }}
          >
            <Text selectable className="font-mono text-[11px] leading-4 text-neutral-300">
              {lines.length ? lines.join('\n') : note || 'Starting…'}
            </Text>
          </ScrollView>
          {!atBottom && (
            <Button
              accessibilityRole="button"
              accessibilityLabel="Jump to latest log line"
              onPress={jumpToLatest}
              hitSlop={8}
              variant="default"
              size="icon"
              className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-full"
            >
              <ArrowDown size={15} color="#fff" />
            </Button>
          )}
        </View>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        description={confirm?.body}
        confirmLabel={confirm?.confirmLabel}
        destructive
        onConfirm={() => confirm?.run()}
        onOpenChange={(o) => {
          if (!o) setConfirm(null);
        }}
      />
    </View>
  );
}
