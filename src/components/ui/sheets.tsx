import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Check, Copy, Info, KeyRound, Lock, MessageSquare, TriangleAlert } from 'lucide-react-native';
import { parseClarify } from '../../utils/messages';
import { mergeUsage, contextTone } from '../../utils/usage';
import { compactNumber } from '../../utils/format';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { placeholderColor, screenBg } from '../../theme';
import type { GatewayWs, ServerAsk } from '../../services/gateway-ws';
import { Button } from './button';
import { Input } from './input';
import { Progress } from './progress';
import { Text as UIText } from './text';

export const renderBackdrop = (props: any) => (
  <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
);

export const renderStaticBackdrop = (props: any) => (
  <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} pressBehavior="none" />
);

// ── Session info sheet ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View className="flex-row gap-2 py-1">
      <Text className="w-[88px] shrink-0 text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400">{label}</Text>
      <Text selectable className="min-w-0 flex-1 text-sm leading-[18px] text-neutral-950 dark:text-neutral-100">
        {value}
      </Text>
    </View>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 gap-0.5 rounded-xl bg-[#f4f4f6] px-3 py-2 dark:bg-[#212121]">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </Text>
      <Text className="text-[16px] font-bold text-neutral-950 dark:text-neutral-100" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export const InfoSheet = forwardRef<
  BottomSheetModal,
  {
    onClose: () => void;
    title: string;
    model: string;
    provider: string;
    info: any;
    usage: any;
    usageLoading: boolean;
    onRename: (title: string) => void;
    tokenEstimate: number;
  }
>(function InfoSheet({ onClose, title, model, provider, info, usage, usageLoading, onRename, tokenEstimate }, ref) {
  const snapPoints = useMemo(() => ['60%', '90%'], []);
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  // Usage arrives in two shapes (nested under session.info or flat from
  // session.usage) — one reader covers both, same as the composer strip.
  const snap = mergeUsage(info?.usage, usage);
  const ctxPct =
    snap?.contextPercent != null ? Math.max(0, Math.min(100, Math.round(snap.contextPercent))) : null;
  const tone = ctxPct == null ? 'ok' : contextTone(ctxPct);
  // Stat grid, chunked into pairs so every row fills evenly.
  const stats: [string, string][] = [];
  if (snap?.input != null) stats.push(['Input', compactNumber(snap.input)]);
  if (snap?.output != null) stats.push(['Output', compactNumber(snap.output)]);
  if (snap?.total != null) stats.push(['Total tokens', compactNumber(snap.total)]);
  if (snap?.costUsd != null && snap.costUsd > 0) stats.push(['Cost', `$${snap.costUsd.toFixed(2)}`]);
  if (snap?.subagents != null) stats.push(['Subagents', String(snap.subagents)]);
  const statRows: [string, string][][] = [];
  for (let i = 0; i < stats.length; i += 2) statRows.push(stats.slice(i, i + 2));
  const canSave = draft.trim().length > 0 && draft.trim() !== title;
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: screenBg(dark) }}
      handleIndicatorStyle={{ backgroundColor: dark ? '#525252' : '#d4d4d4' }}
      onDismiss={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Session info</Text>
        <View className="gap-1 rounded-2xl bg-[#f4f4f6] px-3.5 py-2 dark:bg-[#212121]">
          <InfoRow label="Title" value={title || '(untitled)'} />
          <InfoRow label="Model" value={typeof info?.model === 'string' && info.model ? info.model : model || undefined} />
          <InfoRow
            label="Provider"
            value={typeof info?.provider === 'string' && info.provider ? info.provider : provider || undefined}
          />
          <InfoRow label="Profile" value={typeof info?.profile_name === 'string' ? info.profile_name : undefined} />
          <InfoRow
            label="Reasoning"
            value={typeof info?.reasoning_effort_wire === 'string' ? info.reasoning_effort_wire : undefined}
          />
          <InfoRow label="Fast mode" value={info?.fast === true ? 'On' : undefined} />
          <InfoRow label="Working dir" value={typeof info?.cwd === 'string' ? info.cwd : undefined} />
          <InfoRow label="~Tokens" value={tokenEstimate > 0 ? `≈ ${tokenEstimate.toLocaleString()}` : undefined} />
        </View>
        <View className="flex-row items-center gap-2">
          <Input
            className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
            value={draft}
            onChangeText={setDraft}
            placeholder="Rename session…"
            placeholderTextColor={placeholderColor(dark)}
            keyboardAppearance={dark ? 'dark' : 'light'}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => draft.trim() && onRename(draft.trim())}
          />
          <Button
            onPress={() => draft.trim() && onRename(draft.trim())}
            disabled={!canSave}
            variant="default"
            className="px-3.5 py-2"
          >
            <UIText className="text-sm font-semibold">Save</UIText>
          </Button>
        </View>
        <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage</Text>
        {usageLoading ? (
          <View className="flex-row items-center gap-2 py-2">
            <ActivityIndicator size="small" color={dark ? '#888' : '#666'} />
            <Text className="text-sm text-neutral-500 dark:text-neutral-400">loading usage…</Text>
          </View>
        ) : !snap ? (
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">No usage reported yet.</Text>
        ) : (
          <View className="gap-2">
            {ctxPct != null && (
              <View className="gap-1.5 rounded-2xl bg-[#f4f4f6] p-3.5 dark:bg-[#212121]">
                <View className="flex-row items-center justify-between">
                  <Text className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">
                    Context window
                  </Text>
                  <Text
                    className={`text-[13px] font-bold ${
                      tone === 'hot'
                        ? 'text-[#c5221f] dark:text-[#ff8a8a]'
                        : tone === 'warn'
                          ? 'text-[#d97706] dark:text-[#f0b429]'
                          : 'text-neutral-500 dark:text-neutral-400'
                    }`}
                  >
                    {snap.contextEstimated ? '~' : ''}
                    {ctxPct}%
                  </Text>
                </View>
                <Progress
                  value={ctxPct}
                  className="bg-neutral-200 dark:bg-neutral-800"
                  indicatorClassName={
                    tone === 'hot' ? 'bg-[#c5221f]' : tone === 'warn' ? 'bg-[#d97706]' : 'bg-[#1a7f37]'
                  }
                />
                {snap.contextUsed != null && snap.contextMax != null && (
                  <Text className="text-[12px] text-neutral-500 dark:text-neutral-400">
                    {compactNumber(snap.contextUsed)} / {compactNumber(snap.contextMax)} tokens
                  </Text>
                )}
              </View>
            )}
            {statRows.map((row, i) => (
              <View key={i} className="flex-row gap-2">
                {row.map(([label, value]) => (
                  <StatCell key={label} label={label} value={value} />
                ))}
                {row.length === 1 && <View className="flex-1" />}
              </View>
            ))}
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

// ── Ask sheet (clarify / approval / sudo / secret / vault) ───────────────────

export const AskSheet = forwardRef<
  BottomSheetModal,
  {
    ask: ServerAsk | null;
    onValue: (v: string) => void;
    onApproval: (c: string) => boolean;
    onAskResult: (result: Record<string, unknown>) => boolean;
    onDismiss: () => void;
    gw: GatewayWs | null;
    /** Which chat this ask belongs to (the approval acts on the open chat). */
    contextLabel?: string;
  }
>(function AskSheet({ ask, onValue, onApproval, onAskResult, onDismiss, gw, contextLabel }, ref) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  // Which button was tapped — keeps the sheet from answering twice.
  const [sent, setSent] = useState<string | null>(null);
  const [cmdCopied, setCmdCopied] = useState(false);
  const lockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      for (const timer of Object.values(lockTimers.current)) clearTimeout(timer);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const snapPoints = useMemo(() => ['60%', '90%'], []);
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // Both the clarify answer box and the sudo/secret field share this colour.
  const placeholder = useMemo(() => placeholderColor(dark), [dark]);

  // Fresh `ask` for the reset effect below. The store hands back a new object
  // for the same RPC whenever it re-hydrates an ask (reconnect, room switch,
  // inbox reply), so `ask` is not a stable identity: depending on it directly
  // would wipe the user's in-progress answer on each of those. Reading it
  // through a ref keeps the effect firing on new requests only (keyed by
  // rpcId) while never capturing a stale payload — same pattern the chat
  // screen uses for its own ask mirror.
  const askMirror = useRef(ask);
  askMirror.current = ask;
  useEffect(() => {
    for (const timer of Object.values(lockTimers.current)) clearTimeout(timer);
    lockTimers.current = {};
    const current = askMirror.current;
    const parsed = current?.method === 'clarify' ? parseClarify(current) : null;
    const restored: Record<string, string[]> = {};
    for (const question of parsed?.questions ?? []) {
      if (question.lockedAnswer) restored[question.qid] = [question.lockedAnswer];
    }
    setText(parsed?.single ? parsed.questions[0]?.lockedAnswer ?? '' : '');
    setPicked(restored);
    setSent(null);
    setCmdCopied(false);
  }, [ask?.rpcId]);

  const renderBody = () => {
    if (!ask) return null;
    const m = ask.method;

    // Batch/single clarify — answer locks per question via clarify.lock so the
    // agent sees partial progress; the final answer set resolves the request.
    // Debounced: rapid multi-select taps used to spam one RPC per tap.
    if (m === 'clarify') {
      const { single, questions } = parseClarify(ask);
      const toggle = (qid: string, choice: string, multi: boolean) => {
        setPicked((prev) => {
          const cur = prev[qid] ?? [];
          const next = multi
            ? cur.includes(choice)
              ? cur.filter((c) => c !== choice)
              : [...cur, choice]
            : [choice];
          const nextAll = { ...prev, [qid]: next };
          const rpcId = ask.rpcId;
          if (lockTimers.current[qid]) clearTimeout(lockTimers.current[qid]);
          lockTimers.current[qid] = setTimeout(() => {
            const payload = nextAll[qid]?.join(', ') ?? '';
            gw?.call('clarify.lock', { request_id: rpcId, question_id: qid, answer: payload }).catch(() => {});
          }, 300);
          return nextAll;
        });
      };
      const submitAll = () => {
        if (!gw) return;
        let result: Record<string, unknown>;
        if (single) {
          const q = questions[0];
          const ans = picked[q.qid]?.join(', ') ?? text.trim();
          result = { answer: ans };
        } else {
          const answers: Record<string, string> = {};
          for (const q of questions) answers[q.qid] = picked[q.qid]?.join(', ') ?? '';
          result = { answers };
        }
        if (onAskResult(result)) onDismiss();
      };
      return (
        <>
          <View className="flex-row items-center gap-2">
            <MessageSquare size={18} color={dark ? '#f5f5f5' : '#111'} />
            <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Clarify</Text>
          </View>
          {questions.map((q) => (
            <View key={q.qid} className="gap-1.5">
              {!!q.question && <Text className="text-sm text-neutral-700 dark:text-neutral-200">{q.question}</Text>}
              <View className="flex-row flex-wrap gap-2">
                {q.choices.map((c) => {
                  const on = (picked[q.qid] ?? []).includes(c);
                  return (
                    <Button key={c} onPress={() => toggle(q.qid, c, q.multiSelect)} variant={on ? 'default' : 'outline'} size="sm" className="rounded-full px-3 py-[7px]">
                      <UIText className="text-sm">{c}</UIText>
                    </Button>
                  );
                })}
              </View>
              {q.choices.length === 0 && (
                <TextInput
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
                  value={text}
                  onChangeText={setText}
                  placeholder="Type your answer…"
                  placeholderTextColor={placeholder}
                  keyboardAppearance={dark ? 'dark' : 'light'}
                  multiline
                />
              )}
            </View>
          ))}
          <View className="flex-row items-center justify-end gap-2.5">
            <Button onPress={submitAll} variant="default" className="mt-2 px-[18px] py-[11px]">
              <UIText className="text-[15px] font-semibold">Send answer</UIText>
            </Button>
          </View>
        </>
      );
    }

    // Dangerous-command approval — choice list comes from the payload, labels
    // are ours: the raw wire values ("once"/"session"/"always"/"deny") read as
    // gibberish in a pill, and "deny" was styled in the allow colour.
    if (m === 'approval') {
      const raw: string[] = Array.isArray(ask.params.choices) && ask.params.choices.length > 0
        ? ask.params.choices.map(String)
        : ['once', 'deny'];
      const CHOICE: Record<string, { label: string; hint: string }> = {
        once: { label: 'Allow once', hint: 'Just this command' },
        session: { label: 'Allow for this session', hint: 'Until the chat ends' },
        always: { label: 'Always allow', hint: 'Saved to the allow-list' },
        deny: { label: 'Deny', hint: 'The agent stops here' },
      };
      const order = ['once', 'session', 'always', 'deny'];
      const choices = [...raw].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const cmd = ask.params.command ? String(ask.params.command) : '';
      // Payload keys per tools/approval.py: command + description (+ flags).
      const description = ask.params.description ? String(ask.params.description) : '';
      const answer = (c: string) => {
        if (sent) return;
        if (onApproval(c)) setSent(c);
      };
      const copyCmd = () => {
        if (!cmd) return;
        void Clipboard.setStringAsync(cmd).then(() => {
          setCmdCopied(true);
          if (copyTimer.current) clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCmdCopied(false), 1200);
        });
      };
      return (
        <>
          <View className="flex-row items-center gap-2">
            <TriangleAlert size={18} color="#d97706" />
            <Text className="min-w-0 flex-1 text-[17px] font-bold text-neutral-950 dark:text-neutral-100">
              Allow this command?
            </Text>
          </View>
          {!!contextLabel && (
            <Text className="text-[13px] text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
              in {contextLabel}
            </Text>
          )}
          {!!description && (
            <Text className="text-sm text-neutral-700 dark:text-neutral-200">{description}</Text>
          )}
          {!!cmd && (
            <View className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Command
                </Text>
                <Button
                  onPress={copyCmd}
                  accessibilityRole="button"
                  accessibilityLabel={cmdCopied ? 'Copied' : 'Copy command'}
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2 py-1"
                  hitSlop={8}
                >
                  {cmdCopied ? (
                    <Check size={14} color={dark ? '#5fd28a' : '#1a7f37'} />
                  ) : (
                    <Copy size={14} color={dark ? '#aaa' : '#666'} />
                  )}
                  <UIText className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                    {cmdCopied ? 'Copied' : 'Copy'}
                  </UIText>
                </Button>
              </View>
              {/* Long commands scroll inside their own box, not pushing the
                  buttons off the bottom of the sheet. */}
              <ScrollView
                className="max-h-[150px] rounded-lg bg-[#f4f4f6] dark:bg-[#212121]"
                contentContainerStyle={{ padding: 8 }}
                nestedScrollEnabled
              >
                <Text selectable className="font-mono text-[13px] leading-[18px] text-neutral-950 dark:text-neutral-100">
                  {cmd}
                </Text>
              </ScrollView>
            </View>
          )}
          <View className="gap-2 pt-1">
            {choices.map((c) => {
              const deny = c === 'deny';
              const meta = CHOICE[c] ?? { label: c, hint: '' };
              const busy = sent !== null;
              return (
                <Button
                  key={c}
                  disabled={busy}
                  onPress={() => answer(c)}
                  variant={deny ? 'destructive' : 'default'}
                  className="flex-col gap-0.5 px-4 py-2.5"
                >
                  <UIText
                    className="text-center text-[15px] font-semibold"
                  >
                    {meta.label}
                  </UIText>
                  {!!meta.hint && (
                    <UIText
                      className="mt-0.5 text-center text-[12px]"
                    >
                      {meta.hint}
                    </UIText>
                  )}
                </Button>
              );
            })}
          </View>
        </>
      );
    }

    // Sudo / secret / vault / GUI reads — single masked string under "value".
    const sheetIcon =
      m === 'sudo' ? (
        <KeyRound size={18} color={dark ? '#f5f5f5' : '#111'} />
      ) : m === 'secret' || m.startsWith('vault.') ? (
        <Lock size={18} color={dark ? '#f5f5f5' : '#111'} />
      ) : (
        <Info size={18} color={dark ? '#f5f5f5' : '#111'} />
      );
    const label =
      m === 'sudo'
        ? 'Sudo password'
        : m === 'secret'
          ? String(ask.params.prompt ?? ask.params.env_var ?? 'Secret')
          : m.startsWith('vault.')
            ? String(ask.params.display_name ?? ask.params.site ?? m)
            : `${m}`;
    return (
      <>
        <View className="flex-row items-center gap-2">
          {sheetIcon}
          <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">{label}</Text>
        </View>
        {!!ask.params.command && <Text className="rounded-lg bg-[#f4f4f6] dark:bg-[#212121] p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">{String(ask.params.command)}</Text>}
        <Input
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={text}
          onChangeText={setText}
          placeholder="…"
          placeholderTextColor={placeholder}
          keyboardAppearance={dark ? 'dark' : 'light'}
          secureTextEntry
          autoFocus
        />
        <View className="flex-row items-center justify-end gap-2.5">
          <Button onPress={() => onValue('')} variant="outline" size="sm" className="px-2.5 py-1.5">
            <UIText>Skip</UIText>
          </Button>
          <Button onPress={() => onValue(text)} variant="default" className="mt-2 px-[18px] py-[11px]">
            <UIText className="text-[15px] font-semibold">Send</UIText>
          </Button>
        </View>
      </>
    );
  };

  // Never swipe/backdrop-dismissable — every path answers or skips
  // explicitly, else the server ask hangs. Dismissal is programmatic
  // (parent presents/dismisses as `ask` changes).
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderStaticBackdrop}
      backgroundStyle={{ backgroundColor: screenBg(dark) }}
      handleIndicatorStyle={{ backgroundColor: dark ? '#525252' : '#d4d4d4' }}
      enablePanDownToClose={false}
      // Lifts the sheet with the keyboard so the sudo/secret input and the
      // approval buttons never sit underneath it.
      keyboardBehavior="interactive"
      onDismiss={onDismiss}
    >
      {/* Scrollable body: a long command or a batch of clarify questions must
          not push the answer buttons past the bottom edge. */}
      <BottomSheetScrollView
        className="bg-white dark:bg-black"
        contentContainerStyle={{ padding: 16, gap: 10 }}
        keyboardShouldPersistTaps="handled"
      >
        {renderBody()}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

// ── Generic form sheet ────────────────────────────────────────────────────────

/**
 * Drives a BottomSheetModal from a boolean so callers never touch present()
 * themselves.
 *
 * Two gorhom behaviours have to be worked around, and both show up as "the
 * sheet only opens once":
 *
 * 1. dismiss() on a sheet that is not currently open flips it to DISMISSED, and
 *    its portal then refuses to render it again - silently, forever. So
 *    `presented` tracks whether it is actually up, and a self-close (swipe,
 *    backdrop, back button - which fires onDismiss without our dismiss()) only
 *    clears the flag.
 * 2. handlePresent reads `mount` from the render it was created in, and skips
 *    snapToIndex() when it is false so the sheet mounts closed and animates
 *    itself open. Calling present() from inside onDismiss therefore lands
 *    *before* the unmount re-render, sees a stale `mount: true`, and snaps the
 *    sheet to its index while it is still animating shut - it ends up stranded
 *    partway up the screen. So a reopen requested mid-close is replayed from an
 *    effect, i.e. after that commit, and only then is the mount path the same
 *    one a first-ever open takes.
 */
export function useSheet(open: boolean) {
  const ref = useRef<BottomSheetModal>(null);
  const presented = useRef(false);
  const dismissing = useRef(false);
  const queued = useRef(false);
  // Bumped to ask for the deferred present; state, not a ref, so the effect
  // below runs after gorhom's own unmount commit.
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    if (replay === 0 || !ref.current) return;
    presented.current = true;
    ref.current.present();
  }, [replay]);

  useEffect(() => {
    if (open) {
      if (presented.current) return;
      if (dismissing.current) {
        queued.current = true;
        return;
      }
      if (!ref.current) return;
      presented.current = true;
      ref.current.present();
    } else if (presented.current) {
      presented.current = false;
      queued.current = false;
      dismissing.current = true;
      ref.current?.dismiss();
    }
  }, [open]);

  /** @returns true when it is reopening, so the caller must not close. */
  const onDismiss = useCallback(() => {
    dismissing.current = false;
    if (queued.current) {
      queued.current = false;
      setReplay((n) => n + 1);
      return true;
    }
    presented.current = false;
    return false;
  }, []);

  return { ref, onDismiss };
}

/**
 * Themed bottom sheet chrome: backdrop, background, pan-down-to-close and
 * keyboard handling. Use it directly when the body brings its own scroller
 * (a list), or via FormSheet for a short form.
 */
export const Sheet = forwardRef<
  BottomSheetModal,
  {
    onClose: () => void;
    /**
     * Fires when the sheet closed itself. Feed this from `useSheet`; returning
     * true means it is reopening right now, so the sheet stays up and
     * `onClose` is not called.
     */
    onDismiss?: () => boolean | void;
    snapPoints?: Array<string | number>;
    children: React.ReactNode;
  }
>(function Sheet({ onClose, onDismiss, snapPoints, children }, ref) {
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints ?? ['85%']}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: screenBg(dark) }}
      handleIndicatorStyle={{ backgroundColor: dark ? '#525252' : '#d4d4d4' }}
      enablePanDownToClose
      // Off, so the sheet fills its snap point. Left on (the default) it hugs
      // its content instead, which for a short form is the stubby sheet that
      // prompted the change. A little dead space under the submit button is the
      // cheaper trade.
      enableDynamicSizing={false}
      // Lifts with the keyboard so inputs and submit buttons stay reachable.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      onDismiss={() => {
        // useSheet replays a queued present() from here; closing on top of it
        // would immediately tear the sheet back down.
        if (onDismiss?.() === true) return;
        onClose();
      }}
    >
      {children}
    </BottomSheetModal>
  );
});

/**
 * Themed bottom sheet for short forms (create/edit). Replaces the hand-rolled
 * `<Modal transparent>` + scrim + `marginBottom: keyboardHeight` blocks: the
 * keyboard handling is the library's, so callers need no Keyboard listener.
 */
export const FormSheet = forwardRef<
  BottomSheetModal,
  {
    onClose: () => void;
    onDismiss?: () => boolean | void;
    snapPoints?: Array<string | number>;
    /** Pinned above the scroller so it stays put while the body scrolls. */
    header?: React.ReactNode;
    children: React.ReactNode;
  }
>(function FormSheet({ onClose, onDismiss, snapPoints, header, children }, ref) {
  return (
    <Sheet ref={ref} onClose={onClose} onDismiss={onDismiss} snapPoints={snapPoints}>
      {header}
      <BottomSheetScrollView
        className="bg-white dark:bg-black"
        contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {children}
      </BottomSheetScrollView>
    </Sheet>
  );
});
