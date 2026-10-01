import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  Check,
  Clock3,
  MessageCircleQuestion,
  ShieldAlert,
  X,
} from 'lucide-react';

import { HamburgerBtn } from '../../components/ui/bits';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { toast } from '../../components/ui/toast';
import { Text as UIText } from '../../components/ui/text';
import { useApp, useThemeValue } from '../../hooks/app-store';
import type { AskInboxEntry } from '../../services/ask-inbox';
import { errMsg, parseClarify } from '../../utils/messages';
import { placeholderColor, screenStyle } from '../../theme';
import { ScrollArea } from '../../components/ui/scroll';

function methodLabel(method: string): string {
  if (method === 'approval') return 'Command approval';
  if (method === 'clarify') return 'Clarification';
  if (method === 'sudo') return 'Sudo password';
  if (method === 'secret') return 'Secret required';
  if (method.startsWith('vault.')) return 'Vault request';
  return method || 'Hermes request';
}

function requestSummary(entry: AskInboxEntry): string {
  const p = entry.params as Record<string, any>;
  if (entry.method === 'approval') {
    return String(
      p.description || p.command || 'A command is waiting for approval.',
    );
  }
  if (entry.method === 'clarify') {
    const question =
      p.question ||
      (Array.isArray(p.questions) ? p.questions[0]?.question : '');
    return String(question || 'Hermes needs an answer.');
  }
  if (entry.method === 'sudo')
    return String(p.command || 'Hermes needs your sudo password.');
  if (entry.method === 'secret')
    return String(p.prompt || p.env_var || 'Hermes needs a secret.');
  if (entry.method.startsWith('vault.')) {
    return String(p.display_name || p.site || 'Hermes needs vault access.');
  }
  return 'Hermes is waiting for input.';
}

const AskCard = memo(function AskCard({
  entry,
  onAnswer,
  onOpen,
}: {
  entry: AskInboxEntry;
  onAnswer: (entry: AskInboxEntry, result: Record<string, unknown>) => void;
  onOpen: (entry: AskInboxEntry) => void;
}) {
  const pending = entry.status === 'pending' || entry.status === 'answering';
  const waiting = pending || entry.status === 'sent';
  const ownerLabel = entry.owner.resolved
    ? `${entry.owner.profile || 'default'} · ${entry.owner.storedSessionId || 'session'}`
    : `session ${entry.sessionId || entry.owner.runtimeSessionId || 'unknown'}`;
  const Icon =
    entry.method === 'approval'
      ? ShieldAlert
      : entry.method === 'clarify'
        ? MessageCircleQuestion
        : AlertCircle;
  const iconColor = entry.method === 'approval' ? '#d97706' : '#2563eb';
  const approvalChoices = Array.isArray(entry.params.choices)
    ? entry.params.choices.map(String)
    : [];
  const canAllow =
    approvalChoices.length === 0 || approvalChoices.includes('once');
  const canDeny =
    approvalChoices.length === 0 || approvalChoices.includes('deny');
  const dark = useThemeValue().theme === 'dark';
  const placeholder = useMemo(() => placeholderColor(dark), [dark]);

  // Answering a queued request needs no chat: the reply rides the JSON-RPC
  // response channel keyed by the ask's rpc id, exactly as the notification
  // actions and the in-chat sheet do. Opening the owning session was the only
  // way before, and it dead-ends for a request whose profile this client has
  // not resolved — the case the inbox exists for.
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const isSecret = entry.method === 'sudo' || entry.method === 'secret' || entry.method.startsWith('vault.');
  const clarify = entry.method === 'clarify' ? parseClarify(entry) : null;

  // A locked answer arrives on a reconnect replay; show it instead of an empty
  // box so a half-answered question does not look unanswered.
  useEffect(() => {
    const restored: Record<string, string[]> = {};
    for (const q of clarify?.questions ?? []) {
      if (q.lockedAnswer) restored[q.qid] = [q.lockedAnswer];
    }
    setPicked(restored);
    setText(clarify?.single ? clarify.questions[0]?.lockedAnswer ?? '' : '');
  }, [entry.key, clarify?.single]);

  const submit = useCallback(() => {
    if (clarify) {
      if (clarify.single) {
        const q = clarify.questions[0];
        const answer = picked[q?.qid ?? '']?.join(', ') ?? text.trim();
        if (!answer) return;
        onAnswer(entry, { answer });
        return;
      }
      // Multi-question: every question needs an answer, and the wire shape is a
      // qid→answer map (see the ask sheet's submitAll).
      const answers: Record<string, string> = {};
      for (const q of clarify.questions) {
        const value = picked[q.qid]?.join(', ') ?? '';
        if (!value) return;
        answers[q.qid] = value;
      }
      onAnswer(entry, { answers });
      return;
    }
    onAnswer(entry, { value: text });
  }, [clarify, entry, onAnswer, picked, text]);

  const canSubmit = clarify
    ? clarify.single
      ? Boolean(picked[clarify.questions[0]?.qid ?? '']?.length || text.trim())
      : clarify.questions.every((q) => Boolean(picked[q.qid]?.length))
    : true;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40">
          <Icon size={18} color={iconColor} />
        </div>
        <div className="min-w-0 flex-1">
          <UIText className="text-[15px] font-bold text-neutral-950 dark:text-neutral-100">
            {methodLabel(entry.method)}
          </UIText>
          <UIText
            className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400"
            numberOfLines={1}
>
            {ownerLabel}
          </UIText>
        </div>
        {waiting ? (
          <Badge variant="secondary" className="border-transparent py-1">
            <UIText className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">
              {entry.status === 'sent' ? 'Sent' : 'Waiting'}
            </UIText>
          </Badge>
        ) : (
          <Badge variant="secondary" className="border-transparent py-1">
            <UIText className="text-[10px] font-bold uppercase text-neutral-500 dark:text-neutral-400">
              {entry.status}
            </UIText>
          </Badge>
        )}
      </div>

      <UIText className="mt-3 text-sm leading-5 text-neutral-700 dark:text-neutral-200">
        {requestSummary(entry)}
      </UIText>

      {entry.method === 'approval' && !!entry.params.command && (
        <div className="mt-2 rounded-xl bg-neutral-100 p-2.5 dark:bg-neutral-900">
          <UIText
            numberOfLines={3}
            className="font-mono text-xs text-neutral-800 dark:text-neutral-200"
>
            {String(entry.params.command)}
          </UIText>
        </div>
      )}

      {pending && (
        <div className="mt-3 gap-3">
          {entry.method === 'approval' ? (
            <div className="flex flex-wrap gap-2">
              {canAllow && (
                <Button
                  onClick={() => onAnswer(entry, { choice: 'once' })}
                  aria-label="Allow once"
                  className="h-auto flex-1 rounded-xl bg-[#1a73e8] px-3 py-2.5"
>
                  <UIText className="text-sm font-semibold text-white">
                    Allow once
                  </UIText>
                </Button>
              )}
              {canDeny && (
                <Button
                  variant="outline"
                  onClick={() => onAnswer(entry, { choice: 'deny' })}
                  aria-label="Reject request"
                  className="h-auto flex-1 rounded-xl border-red-200 px-3 py-2.5 dark:border-red-950"
>
                  <UIText className="text-sm font-semibold text-red-600 dark:text-red-400">
                    Reject
                  </UIText>
                </Button>
              )}
            </div>
          ) : clarify ? (
            /* Clarify: choices become pills, a free-form question an input. */
            <div className="gap-2.5">
              {clarify.questions.map((q) => {
                const sel = picked[q.qid] ?? [];
                return (
                  <div key={q.qid} className="gap-1.5">
                    {!!q.question && (
                      <UIText className="text-sm text-neutral-700 dark:text-neutral-200">
                        {q.question}
                      </UIText>
                    )}
                    {q.choices.length> 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {q.choices.map((c) => {
                          const on = sel.includes(c);
                          return (
                            <Button
                              key={c}
                              variant={on ? 'default' : 'outline'}
                              size="sm"

                              aria-pressed={on} aria-checked={on}
                              aria-label={c}
                              onClick={() =>
                                setPicked((prev) => {
                                  const cur = prev[q.qid] ?? [];
                                  const next = q.multiSelect
                                    ? cur.includes(c)
                                      ? cur.filter((x) => x !== c)
                                      : [...cur, c]
                                    : [c];
                                  return { ...prev, [q.qid]: next };
                                })
                              }
                              className="h-auto rounded-full px-3 py-1.5"
>
                              <UIText className="text-[13px]">{c}</UIText>
                            </Button>
                          );
                        })}
                      </div>
                    ) : (
                      <Input
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Type your answer…"

                        aria-label="Your answer"
                        className="min-h-[60px] rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                      />
                    )}
                  </div>
                );
              })}
              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => onOpen(entry)}
                  aria-label="Open in chat"
                  variant="ghost"
                  size="sm"
                  className="h-auto rounded-lg px-2.5 py-1.5"
>
                  <UIText className="text-[13px] text-neutral-500 dark:text-neutral-400">
                    Open in chat
                  </UIText>
                </Button>
                <Button
                  onClick={submit}
                  disabled={!canSubmit}
                  aria-label="Send answer"
                  className="h-auto rounded-xl bg-[#1a73e8] px-4 py-2"
>
                  <UIText className="text-sm font-semibold text-white">Send</UIText>
                </Button>
              </div>
            </div>
          ) : (
            /* Sudo / secret / vault: one masked string, matching the ask sheet. */
            <div className="gap-2">
              <Input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={isSecret ? 'Enter value' : 'Type your answer…'}

                autoCapitalize="none"
                aria-label="Your answer"
                className="rounded-xl border border-neutral-300 px-3 py-2.5 text-sm text-neutral-950 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  onClick={() => onOpen(entry)}
                  aria-label="Open in chat"
                  variant="ghost"
                  size="sm"
                  className="h-auto rounded-lg px-2.5 py-1.5"
>
                  <UIText className="text-[13px] text-neutral-500 dark:text-neutral-400">
                    Open in chat
                  </UIText>
                </Button>
                <Button
                  onClick={submit}
                  aria-label="Send answer"
                  className="h-auto rounded-xl bg-[#1a73e8] px-4 py-2"
>
                  <UIText className="text-sm font-semibold text-white">Send</UIText>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export function AskInboxScreen() {
  const {
    authed,
    askInbox,
    pendingAskCount,
    activeProfile,
    respondToInbox,
    openAskEntry,
  } = useApp();
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  // The store's `error` is the connect/login banner, not this screen's — a
  // stale connection failure used to render as an alert above the inbox, where
  // it read as if the inbox itself were broken. Failures are reported per
  // action instead.
  const placeholder = useMemo(() => placeholderColor(dark), [dark]);

  useEffect(() => {
    (navigation as any).setOptions?.({
      headerLeft: () => <HamburgerBtn />,
      headerTintColor: dark ? '#f5f5f5' : '#111',
      title: 'Ask Inbox',
    });
  }, [navigation, dark]);

  const pending = useMemo(
    () =>
      askInbox.filter(
        (entry) => entry.status === 'pending' || entry.status === 'answering' || entry.status === 'sent',
      ),
    [askInbox],
  );
  const settled = useMemo(
    () =>
      askInbox.filter(
        (entry) => entry.status !== 'pending' && entry.status !== 'answering' && entry.status !== 'sent',
      ),
    [askInbox],
  );

  // Stable callbacks so a new approval arriving doesn't rebuild every card's
  // handlers (AskCard is memoized; settled is capped at 10 rows below, so no
  // virtualized list is needed here).
  const handleAnswer = useCallback(
    (entry: AskInboxEntry, result: Record<string, unknown>) => {
      try {
        if (respondToInbox(entry.key, result)) return;
        // respondToInbox returns false for every reason it cannot deliver —
        // settled, another profile's, no socket — and the interesting one is
        // the profile, since a background request can name a profile this
        // client has not selected. Name it instead of a generic failure.
        const why = entry.owner.profile && entry.owner.profile !== activeProfile
          ? `This request belongs to profile “${entry.owner.profile}”. Switch to it, or open the request in its chat.`
          : 'The gateway is not ready, or this request is no longer pending.';
        toast({ title: 'Could not answer', description: why, variant: 'destructive' });
      } catch (e) {
        toast({ title: 'Could not answer', description: errMsg(e), variant: 'destructive' });
      }
    },
    [activeProfile, respondToInbox],
  );
  const handleOpenAsk = useCallback(
    (entry: AskInboxEntry) => {
      void openAskEntry(entry);
    },
    [openAskEntry],
  );

  if (!authed) {
    return (
      <div className="flex-1 items-center justify-center bg-white dark:bg-black">
        <UIText className="text-neutral-500 dark:text-neutral-400">
          Sign in to view asks.
        </UIText>
      </div>
    );
  }

  return (
    <div style={screenStyle(dark)}>
      
      <div
        className="flex-1 bg-white dark:bg-black"
>
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <HamburgerBtn />
          <UIText className="text-xl font-bold text-neutral-950 dark:text-neutral-100">
            Ask Inbox
          </UIText>
        </div>
        <ScrollArea
          contentClassName="p-[object Object] pb-[object Object] gap-[object Object]"
>
          <div className="mb-1 flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-950/50 dark:bg-blue-950/20">
            <BellRing size={21} color={dark ? '#93c5fd' : '#2563eb'} />
            <div className="flex-1">
              <UIText className="text-sm font-bold text-neutral-950 dark:text-neutral-100">
                {pendingAskCount
                  ? `${pendingAskCount} request${pendingAskCount === 1 ? '' : 's'} waiting`
                  : 'No pending requests'}
              </UIText>
              <UIText className="mt-0.5 text-xs leading-4 text-neutral-600 dark:text-neutral-300">
                Answer here and it goes straight to the waiting session — no need
                to open its chat.
              </UIText>
            </div>
          </div>

          {pending.map((entry) => (
            <AskCard key={entry.key} entry={entry} onAnswer={handleAnswer} onOpen={handleOpenAsk} />
          ))}

          {pending.length === 0 && (
            <div className="items-center rounded-2xl border border-dashed border-neutral-300 px-6 py-12 dark:border-neutral-700">
              <Check size={28} color={dark ? '#86efac' : '#16a34a'} />
              <UIText className="mt-3 text-base font-semibold text-neutral-800 dark:text-neutral-200">
                You are all caught up
              </UIText>
              <UIText className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Approval and clarification requests from background sessions
                will appear here.
              </UIText>
            </div>
          )}

          {settled.length> 0 && (
            <div className="mt-4 gap-2">
              <UIText className="px-1 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Recent
              </UIText>
              {settled.slice(0, 10).map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800"
>
                  {entry.status === 'answered' ? (
                    <Check size={15} color="#16a34a" />
                  ) : (
                    <X size={15} color="#94a3b8" />
                  )}
                  <UIText
                    className="flex-1 text-sm text-neutral-700 dark:text-neutral-300"
                    numberOfLines={1}
>
                    {methodLabel(entry.method)}
                  </UIText>
                  <UIText className="text-[11px] text-neutral-400">
                    {entry.status}
                  </UIText>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-neutral-400 dark:text-neutral-500">
            <Clock3 size={13} />
            <UIText>
              Requests are kept until answered, cancelled, or the session is
              closed.
            </UIText>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
