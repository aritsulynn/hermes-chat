import { forwardRef, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from '@gorhom/bottom-sheet';
import { Info, KeyRound, Lock, MessageSquare, TriangleAlert } from 'lucide-react-native';
import { parseClarify } from '../utils/messages';
import { useApp } from '../hooks/app-store';
import type { GatewayWs, ServerAsk } from '../lib/gateway-ws';

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
      <Text className="w-[72px] text-[13px] text-neutral-500 dark:text-neutral-400">{label}</Text>
      <Text className="flex-1 text-sm text-neutral-950 dark:text-neutral-100" numberOfLines={3}>
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
  const { theme } = useApp();
  const dark = theme === 'dark';
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  return (
    <BottomSheetModal
      ref={ref}
      index={0}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: dark ? '#000' : '#fff' }}
      handleIndicatorStyle={{ backgroundColor: dark ? '#525252' : '#d4d4d4' }}
      onDismiss={onClose}
    >
      <BottomSheetScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <View className="flex-row items-center justify-between">
          <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Session info</Text>
        </View>
        <InfoRow label="Title" value={title} />
        <View className="flex-row items-center gap-2">
          <TextInput
            className="flex-1 rounded-xl border border-neutral-300 dark:border-neutral-700 px-3 py-2 text-sm text-neutral-950 dark:text-neutral-100"
            value={draft}
            onChangeText={setDraft}
            placeholder="Rename session…"
            placeholderTextColor={dark ? '#888' : '#9ca3af'}
            keyboardAppearance={dark ? 'dark' : 'light'}
            autoCapitalize="none"
          />
          <Pressable onPress={() => draft.trim() && onRename(draft.trim())} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
            <Text className="dark:text-neutral-100">Save</Text>
          </Pressable>
        </View>
        <InfoRow label="~Tokens" value={tokenEstimate > 0 ? `≈ ${tokenEstimate.toLocaleString()}` : undefined} />
        <InfoRow label="Model" value={typeof info?.model === 'string' && info.model ? info.model : model} />
        <InfoRow
          label="Provider"
          value={typeof info?.provider === 'string' && info.provider ? info.provider : provider || undefined}
        />
        <InfoRow label="CWD" value={typeof info?.cwd === 'string' ? info.cwd : undefined} />
        <Text className="mt-1 text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage</Text>
        {usageLoading ? (
          <Text className="mb-4 text-sm text-neutral-500 dark:text-neutral-400">loading…</Text>
        ) : (
          <Text className="rounded-lg bg-[#f4f4f6] dark:bg-[#212121] p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">{usage ? JSON.stringify(usage, null, 2) : '—'}</Text>
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
    onApproval: (c: string) => void;
    onDismiss: () => void;
    gw: GatewayWs | null;
  }
>(function AskSheet({ ask, onValue, onApproval, onDismiss, gw }, ref) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  // Which button was tapped — keeps the sheet from answering twice.
  const [sent, setSent] = useState<string | null>(null);
  const snapPoints = useMemo(() => ['60%', '90%'], []);
  const { theme } = useApp();
  const dark = theme === 'dark';

  useEffect(() => {
    setText('');
    setPicked({});
    setSent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.rpcId]);

  const renderBody = () => {
    if (!ask) return null;
    const m = ask.method;

    // Batch/single clarify — answer locks per question via clarify.lock so the
    // agent sees partial progress; the final answer set resolves the request.
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
          // Lock-in: server keeps it even on timeout.
          gw?.call('clarify.lock', { request_id: ask.rpcId, question_id: qid, answer: next.join(', ') }).catch(() => {});
          return { ...prev, [qid]: next };
        });
      };
      const submitAll = () => {
        if (!gw) return;
        if (single) {
          const q = questions[0];
          const ans = picked[q.qid]?.join(', ') ?? text.trim();
          gw.replyToAsk(ask.rpcId, { answer: ans });
        } else {
          const answers: Record<string, string> = {};
          for (const q of questions) answers[q.qid] = picked[q.qid]?.join(', ') ?? '';
          gw.replyToAsk(ask.rpcId, { answers });
        }
        onDismiss();
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
                    <Pressable key={c} onPress={() => toggle(q.qid, c, q.multiSelect)} className={`rounded-full border border-[#1a73e8] px-3 py-[7px] ${on ? 'bg-[#1a73e8]' : ''}`}>
                      <Text className={`text-sm ${on ? 'text-white' : 'text-[#1a73e8]'}`}>{c}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {q.choices.length === 0 && (
                <TextInput
                  className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
                  value={text}
                  onChangeText={setText}
                  placeholder="Type your answer…"
                  placeholderTextColor={dark ? '#888' : '#9ca3af'}
                  keyboardAppearance={dark ? 'dark' : 'light'}
                  multiline
                />
              )}
            </View>
          ))}
          <View className="flex-row items-center justify-end gap-2.5">
            <Pressable onPress={submitAll} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]">
              <Text className="text-[15px] font-semibold text-white">Send answer</Text>
            </Pressable>
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
        setSent(c);
        onApproval(c);
      };
      return (
        <>
          <View className="flex-row items-center gap-2">
            <TriangleAlert size={18} color="#d97706" />
            <Text className="flex-1 text-[17px] font-bold text-neutral-950 dark:text-neutral-100">
              Allow this command?
            </Text>
          </View>
          {!!description && (
            <Text className="text-sm text-neutral-700 dark:text-neutral-200">{description}</Text>
          )}
          {!!cmd && (
            // Long commands must scroll inside their own box, not push the
            // buttons off the bottom of the sheet.
            <ScrollView
              className="max-h-[150px] rounded-lg bg-[#f4f4f6] dark:bg-[#212121]"
              contentContainerStyle={{ padding: 8 }}
              nestedScrollEnabled
            >
              <Text selectable className="font-mono text-[13px] leading-[18px] text-neutral-950 dark:text-neutral-100">
                {cmd}
              </Text>
            </ScrollView>
          )}
          <View className="gap-2 pt-1">
            {choices.map((c) => {
              const deny = c === 'deny';
              const meta = CHOICE[c] ?? { label: c, hint: '' };
              const busy = sent !== null;
              return (
                <Pressable
                  key={c}
                  disabled={busy}
                  onPress={() => answer(c)}
                  className={`rounded-xl px-4 py-2.5 ${deny ? 'border border-[#c5221f] dark:border-[#ff7b72]' : 'bg-[#1a73e8]'} ${busy ? 'opacity-50' : ''}`}
                >
                  <Text
                    className={`text-center text-[15px] font-semibold ${deny ? 'text-[#c5221f] dark:text-[#ff7b72]' : 'text-white'}`}
                  >
                    {meta.label}
                  </Text>
                  {!!meta.hint && (
                    <Text
                      className={`mt-0.5 text-center text-[12px] ${deny ? 'text-[#c5221f] dark:text-[#ff7b72]' : 'text-white/75'}`}
                    >
                      {meta.hint}
                    </Text>
                  )}
                </Pressable>
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
        <TextInput
          className="rounded-lg border border-neutral-300 dark:border-neutral-700 p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={text}
          onChangeText={setText}
          placeholder="…"
          placeholderTextColor={dark ? '#888' : '#9ca3af'}
          keyboardAppearance={dark ? 'dark' : 'light'}
          secureTextEntry
          autoFocus
        />
        <View className="flex-row items-center justify-end gap-2.5">
          <Pressable onPress={() => onValue('')} className="rounded-lg border border-neutral-300 dark:border-neutral-700 px-2.5 py-1.5">
            <Text className="dark:text-neutral-100">Skip</Text>
          </Pressable>
          <Pressable onPress={() => onValue(text)} className="mt-2 items-center rounded-lg bg-[#1a73e8] px-[18px] py-[11px]">
            <Text className="text-[15px] font-semibold text-white">Send</Text>
          </Pressable>
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
      backgroundStyle={{ backgroundColor: dark ? '#000' : '#fff' }}
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
