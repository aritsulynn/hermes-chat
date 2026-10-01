// Bottom sheets, as Radix dialogs pinned to the bottom of the viewport.
//
// The native build drove @gorhom/bottom-sheet imperatively: the parent held a
// ref and called present()/dismiss(). `useSheet` existed to paper over two
// gorhom bugs — a dismiss() on a closed sheet wedging its portal forever, and a
// present() issued mid-dismiss animation leaving the sheet stranded halfway up
// the screen. Both were library bugs with no web equivalent, so the whole
// dance is gone: a sheet is now `<Dialog open>`, and the parent's boolean is
// the single source of truth. `snapPoints` survives as a max-height, which is
// the only part of it that ever meant anything visually.
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Info, KeyRound, Lock, MessageSquare, TriangleAlert } from 'lucide-react';
import { parseClarify } from '../../utils/messages';
import { mergeUsage, contextTone } from '../../utils/usage';
import { compactNumber } from '../../utils/format';
import { useThemeValue } from '../../hooks/app-store';
import { cn } from '../../utils/cn';
import { placeholderColor, screenBg } from '../../theme';
import type { GatewayWs, ServerAsk } from '../../services/gateway-ws';
import { Button } from './button';
import { Input } from './input';
import { Progress } from './progress';
import { Text } from './text';

/** `['70%']` -> `max-h-[70%]`. A sheet with no snap points fills the viewport. */
function snapHeight(snapPoints?: Array<string | number>): string {
  if (!snapPoints?.length) return 'max-h-[92vh]';
  return `max-h-[${snapPoints[0]}]`;
}

const sheetBody = 'flex flex-col gap-2.5 overflow-y-auto overscroll-contain p-4';

function SheetChrome({
  open,
  onOpenChange,
  className,
  children,
  /** The drag handle is decorative here — there is no pan-to-dismiss. */
  handle = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
  handle?: boolean;
}) {
  const { theme } = useThemeValue();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92vh] flex-col rounded-t-2xl shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            className,
          )}
          style={{ background: screenBg(theme === 'dark') }}>
          {handle && (
            <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
              <div
                className={cn('h-1 w-9 rounded-full', theme === 'dark' ? 'bg-[#525252]' : 'bg-[#d4d4d4]')}
              />
            </div>
          )}
          {/*
            Radix requires a Title for accessibility, but these sheets are
            visually titled by their own first row. Screen-reader-only keeps the
            requirement satisfied without inventing a second heading.
          */}
          <DialogPrimitive.Title className="sr-only">Sheet</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ── Session info sheet ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 py-1">
      <Text className="w-[88px] shrink-0 text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400">
        {label}
      </Text>
      <Text className="min-w-0 flex-1 select-text text-sm leading-[18px] text-neutral-950 dark:text-neutral-100">
        {value}
      </Text>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5 rounded-xl bg-[#f4f4f6] px-3 py-2 dark:bg-[#212121]">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        {label}
      </Text>
      <Text numberOfLines={1} className="text-[16px] font-bold text-neutral-950 dark:text-neutral-100">
        {value}
      </Text>
    </div>
  );
}

function InfoSheetContent({
  title,
  model,
  provider,
  info,
  usage,
  usageLoading,
  onRename,
  tokenEstimate,
}: {
  title: string;
  model: string;
  provider: string;
  info: any;
  usage: any;
  usageLoading: boolean;
  onRename: (title: string) => void;
  tokenEstimate: number;
}) {
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
    <div className={cn(sheetBody, 'gap-3')}>
      <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Session info</Text>
      <div className="flex flex-col gap-1 rounded-2xl bg-[#f4f4f6] px-3.5 py-2 dark:bg-[#212121]">
        <InfoRow label="Title" value={title || '(untitled)'} />
        <InfoRow
          label="Model"
          value={typeof info?.model === 'string' && info.model ? info.model : model || undefined}
        />
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
      </div>
      <div className="flex items-center gap-2">
        <Input
          className="min-w-0 flex-1 rounded-xl border border-neutral-300 px-3 py-2 text-sm text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Rename session…"
          autoCapitalize="none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) onRename(draft.trim());
          }}
        />
        <Button onClick={() => draft.trim() && onRename(draft.trim())} disabled={!canSave} className="px-3.5 py-2">
          <Text className="text-sm font-semibold">Save</Text>
        </Button>
      </div>
      <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">Usage</Text>
      {usageLoading ? (
        <div className="flex items-center gap-2 py-2">
          <Spinner dark={dark} />
          <Text className="text-sm text-neutral-500 dark:text-neutral-400">loading usage…</Text>
        </div>
      ) : !snap ? (
        <Text className="text-sm text-neutral-500 dark:text-neutral-400">No usage reported yet.</Text>
      ) : (
        <div className="flex flex-col gap-2">
          {ctxPct != null && (
            <div className="flex flex-col gap-1.5 rounded-2xl bg-[#f4f4f6] p-3.5 dark:bg-[#212121]">
              <div className="flex items-center justify-between">
                <Text className="text-[13px] font-semibold text-neutral-700 dark:text-neutral-300">
                  Context window
                </Text>
                <Text
                  className={cn(
                    'text-[13px] font-bold',
                    tone === 'hot'
                      ? 'text-[#c5221f] dark:text-[#ff8a8a]'
                      : tone === 'warn'
                        ? 'text-[#d97706] dark:text-[#f0b429]'
                        : 'text-neutral-500 dark:text-neutral-400',
                  )}>
                  {snap.contextEstimated ? '~' : ''}
                  {ctxPct}%
                </Text>
              </div>
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
            </div>
          )}
          {statRows.map((row, i) => (
            <div key={i} className="flex gap-2">
              {row.map(([label, value]) => (
                <StatCell key={label} label={label} value={value} />
              ))}
              {row.length === 1 && <div className="flex-1" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export const InfoSheet = forwardRef<
  HTMLDivElement,
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    model: string;
    provider: string;
    info: any;
    usage: any;
    usageLoading: boolean;
    onRename: (title: string) => void;
    tokenEstimate: number;
  }
>(function InfoSheet({ open, onOpenChange, ...rest }, ref) {
  return (
    <SheetChrome open={open} onOpenChange={onOpenChange} className={snapHeight(['90vh'])}>
      <InfoSheetContent {...rest} />
    </SheetChrome>
  );
});

// ── Ask sheet (clarify / approval / sudo / secret / vault) ───────────────────

export const AskSheet = forwardRef<
  HTMLDivElement,
  {
    open: boolean;
    ask: ServerAsk | null;
    onValue: (v: string) => void;
    onApproval: (c: string) => boolean;
    onAskResult: (result: Record<string, unknown>) => boolean;
    gw: GatewayWs | null;
    /** Which chat this ask belongs to (the approval acts on the open chat). */
    contextLabel?: string;
  }
>(function AskSheet({ open, ask, onValue, onApproval, onAskResult, gw, contextLabel }, ref) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  // Which button was tapped — keeps the sheet from answering twice.
  const [sent, setSent] = useState<string | null>(null);
  const [cmdCopied, setCmdCopied] = useState(false);
  const lockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  useEffect(
    () => () => {
      for (const timer of Object.values(lockTimers.current)) clearTimeout(timer);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

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
    setText(parsed?.single ? (parsed.questions[0]?.lockedAnswer ?? '') : '');
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
        onAskResult(result);
      };
      return (
        <>
          <div className="flex items-center gap-2">
            <MessageSquare size={18} color={dark ? '#f5f5f5' : '#111'} />
            <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Clarify</Text>
          </div>
          {questions.map((q) => (
            <div key={q.qid} className="flex flex-col gap-1.5">
              {!!q.question && (
                <Text className="text-sm text-neutral-700 dark:text-neutral-200">{q.question}</Text>
              )}
              <div className="flex flex-wrap gap-2">
                {q.choices.map((c) => {
                  const on = (picked[q.qid] ?? []).includes(c);
                  return (
                    <Button
                      key={c}
                      onClick={() => toggle(q.qid, c, q.multiSelect)}
                      variant={on ? 'default' : 'outline'}
                      size="sm"
                      className="rounded-full px-3 py-[7px]">
                      <Text className="text-sm">{c}</Text>
                    </Button>
                  );
                })}
              </div>
              {q.choices.length === 0 && (
                <textarea
                  className="w-full rounded-lg border border-neutral-300 bg-transparent p-2.5 text-[15px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type your answer…"
                  rows={2}
                />
              )}
            </div>
          ))}
          <div className="flex items-center justify-end gap-2.5">
            <Button onClick={submitAll} className="mt-2 px-[18px] py-[11px]">
              <Text className="text-[15px] font-semibold">Send answer</Text>
            </Button>
          </div>
        </>
      );
    }

    // Dangerous-command approval — choice list comes from the payload, labels
    // are ours: the raw wire values ("once"/"session"/"always"/"deny") read as
    // gibberish in a pill, and "deny" was styled in the allow colour.
    if (m === 'approval') {
      const raw: string[] =
        Array.isArray(ask.params.choices) && ask.params.choices.length > 0
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
      const copyCmd = async () => {
        if (!cmd) return;
        try {
          await navigator.clipboard?.writeText(cmd);
          setCmdCopied(true);
          if (copyTimer.current) clearTimeout(copyTimer.current);
          copyTimer.current = setTimeout(() => setCmdCopied(false), 1200);
        } catch {}
      };
      return (
        <>
          <div className="flex items-center gap-2">
            <TriangleAlert size={18} color="#d97706" />
            <Text className="min-w-0 flex-1 text-[17px] font-bold text-neutral-950 dark:text-neutral-100">
              Allow this command?
            </Text>
          </div>
          {!!contextLabel && (
            <Text numberOfLines={1} className="text-[13px] text-neutral-500 dark:text-neutral-400">
              in {contextLabel}
            </Text>
          )}
          {!!description && <Text className="text-sm text-neutral-700 dark:text-neutral-200">{description}</Text>}
          {!!cmd && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Text className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Command
                </Text>
                <Button
                  onClick={copyCmd}
                  aria-label={cmdCopied ? 'Copied' : 'Copy command'}
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2 py-1">
                  {cmdCopied ? (
                    <Check size={14} color={dark ? '#5fd28a' : '#1a7f37'} />
                  ) : (
                    <Copy size={14} color={dark ? '#aaa' : '#666'} />
                  )}
                  <Text className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                    {cmdCopied ? 'Copied' : 'Copy'}
                  </Text>
                </Button>
              </div>
              {/* Long commands scroll inside their own box, not pushing the
                  buttons off the bottom of the sheet. */}
              <div className="max-h-[150px] overflow-y-auto overscroll-contain rounded-lg bg-[#f4f4f6] p-2 dark:bg-[#212121]">
                <Text className="select-text font-mono text-[13px] leading-[18px] text-neutral-950 dark:text-neutral-100">
                  {cmd}
                </Text>
              </div>
            </div>
          )}
          <div className="flex flex-col gap-2 pt-1">
            {choices.map((c) => {
              const deny = c === 'deny';
              const meta = CHOICE[c] ?? { label: c, hint: '' };
              const busy = sent !== null;
              return (
                <Button
                  key={c}
                  disabled={busy}
                  onClick={() => answer(c)}
                  variant={deny ? 'destructive' : 'default'}
                  className="flex-col gap-0.5 px-4 py-2.5">
                  <Text className="text-center text-[15px] font-semibold">{meta.label}</Text>
                  {!!meta.hint && <Text className="mt-0.5 text-center text-[12px]">{meta.hint}</Text>}
                </Button>
              );
            })}
          </div>
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
        <div className="flex items-center gap-2">
          {sheetIcon}
          <Text className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">{label}</Text>
        </div>
        {!!ask.params.command && (
          <Text className="select-text rounded-lg bg-[#f4f4f6] p-2 font-mono text-[13px] text-neutral-950 dark:bg-[#212121] dark:text-neutral-100">
            {String(ask.params.command)}
          </Text>
        )}
        <Input
          className="rounded-lg border border-neutral-300 p-2.5 text-[15px] text-neutral-950 dark:border-neutral-700 dark:text-neutral-100"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…"
          type="password"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2.5">
          <Button onClick={() => onValue('')} variant="outline" size="sm" className="px-2.5 py-1.5">
            <Text>Skip</Text>
          </Button>
          <Button onClick={() => onValue(text)} className="mt-2 px-[18px] py-[11px]">
            <Text className="text-[15px] font-semibold">Send</Text>
          </Button>
        </div>
      </>
    );
  };

  // The overlay is deliberately dimmer than a normal sheet's: the user is still
  // meant to be able to read the chat this ask came from.
  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Content
          // Not dismissable by backdrop or Escape — every path answers or skips
          // explicitly, else the server ask hangs. The parent opens and closes
          // it as `ask` changes. The ask is modal about the *agent*, not about
          // blocking the user from reading the chat behind it.
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl shadow-lg outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
            snapHeight(['90vh']),
          )}
          style={{ background: screenBg(dark) }}>
          <div className="flex justify-center pt-2.5 pb-1" aria-hidden>
            <div className={cn('h-1 w-9 rounded-full', dark ? 'bg-[#525252]' : 'bg-[#d4d4d4]')} />
          </div>
          <DialogPrimitive.Title className="sr-only">Agent request</DialogPrimitive.Title>
          <div className={sheetBody}>{renderBody()}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
});

/**
 * Themed bottom sheet. Use it directly when the body brings its own scroller
 * (a list), or via FormSheet for a short form.
 */
export const Sheet = forwardRef<
  HTMLDivElement,
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    snapPoints?: Array<string | number>;
    children: React.ReactNode;
  }
>(function Sheet({ open, onOpenChange, snapPoints, children }, ref) {
  return (
    <SheetChrome open={open} onOpenChange={onOpenChange} className={snapHeight(snapPoints)}>
      {children}
    </SheetChrome>
  );
});

/**
 * Themed bottom sheet for short forms (create/edit). The body is a scroller so
 * a long form cannot push its submit button off the bottom edge.
 */
export const FormSheet = forwardRef<
  HTMLDivElement,
  {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    snapPoints?: Array<string | number>;
    /** Pinned above the scroller so it stays put while the body scrolls. */
    header?: React.ReactNode;
    children: React.ReactNode;
  }
>(function FormSheet({ open, onOpenChange, snapPoints, header, children }, ref) {
  return (
    <SheetChrome open={open} onOpenChange={onOpenChange} className={snapHeight(snapPoints)}>
      {header}
      <div className={cn(sheetBody, 'pb-8')}>{children}</div>
    </SheetChrome>
  );
});

/** The native `ActivityIndicator`. A bordered spinning square, no dependency. */
function Spinner({ dark }: { dark: boolean }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block size-4 animate-spin rounded-[3px] border-2 border-current border-t-transparent align-[-2px]',
        dark ? 'text-[#888]' : 'text-[#666]',
      )}
    />
  );
}

export { Spinner };
