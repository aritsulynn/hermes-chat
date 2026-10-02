// Bottom sheets, as Radix dialogs pinned to the bottom of the viewport.
//
// A sheet is `<Dialog open>`: the parent owns a boolean, and that boolean is
// the single source of truth. The body caps at `max-h-[92vh]` and scrolls.
import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Info, KeyRound, Lock, MessageSquare, TriangleAlert } from 'lucide-react';
import { parseClarify } from '../../utils/messages';
import { useThemeValue } from '../../hooks/app-store';
import { cn } from '../../utils/cn';
import { screenBg } from '../../theme';
import type { GatewayWs, ServerAsk } from '../../services/gateway-ws';
import { Button } from './button';
import { Input } from './input';
import { Textarea } from './textarea';

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
              <div className={cn('h-1 w-9 rounded-full', theme === 'dark' ? 'bg-[#525252]' : 'bg-[#d4d4d4]')} />
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

// ── Ask sheet (clarify / approval / sudo / secret / vault) ───────────────────

export function AskSheet({
  open,
  onOpenChange,
  ask,
  onValue,
  onApproval,
  onAskResult,
  gw,
  contextLabel,
}: {
  open: boolean;
  /** Only fires for a programmatic close; the sheet blocks Escape/backdrop. */
  onOpenChange: (open: boolean) => void;
  ask: ServerAsk | null;
  onValue: (v: string) => void;
  onApproval: (c: string) => boolean;
  onAskResult: (result: Record<string, unknown>) => boolean;
  gw: GatewayWs | null;
  /** Which chat this ask belongs to (the approval acts on the open chat). */
  contextLabel?: string;
}) {
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
          const next = multi ? (cur.includes(choice) ? cur.filter((c) => c !== choice) : [...cur, choice]) : [choice];
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
            <div className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Clarify</div>
          </div>
          {questions.map((q) => (
            <div key={q.qid} className="flex flex-col gap-1.5">
              {!!q.question && <div className="text-sm text-neutral-700 dark:text-neutral-200">{q.question}</div>}
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
                      <span className="text-sm">{c}</span>
                    </Button>
                  );
                })}
              </div>
              {/* Was a raw `<textarea>`, and the only field in the app with no focus
                  state of its own — global.css used to cover for that, and that rule
                  is gone (see global.css for why it could not stay). `<Textarea>`
                  brings the ring every other field uses; the overrides here are only
                  this dialog's radius and padding. */}
              {q.choices.length === 0 && (
                <Textarea
                  className="min-h-0 w-full resize-none rounded-lg border-border bg-transparent p-2.5 text-[15px] text-neutral-950 dark:bg-transparent dark:text-neutral-100"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Type your answer…"
                  numberOfLines={2}
                />
              )}
            </div>
          ))}
          <div className="flex items-center justify-end gap-2.5">
            <Button onClick={submitAll} className="mt-2 px-[18px] py-[11px]">
              <span className="text-[15px] font-semibold">Send answer</span>
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
            <div className="min-w-0 flex-1 text-[17px] font-bold text-neutral-950 dark:text-neutral-100">
              Allow this command?
            </div>
          </div>
          {!!contextLabel && (
            <div className="text-[13px] text-neutral-500 dark:text-neutral-400 truncate">in {contextLabel}</div>
          )}
          {!!description && <div className="text-sm text-neutral-700 dark:text-neutral-200">{description}</div>}
          {!!cmd && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                  Command
                </div>
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
                  <span className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                    {cmdCopied ? 'Copied' : 'Copy'}
                  </span>
                </Button>
              </div>
              {/* Long commands scroll inside their own box, not pushing the
                  buttons off the bottom of the sheet. */}
              <div className="max-h-[150px] overflow-y-auto overscroll-contain rounded-lg bg-elevated p-2">
                <div className="select-text font-mono text-[13px] leading-[18px] text-neutral-950 dark:text-neutral-100">
                  {cmd}
                </div>
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
                  <span className="text-center text-[15px] font-semibold">{meta.label}</span>
                  {!!meta.hint && <span className="mt-0.5 text-center text-[12px]">{meta.hint}</span>}
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
          <div className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">{label}</div>
        </div>
        {!!ask.params.command && (
          <div className="select-text rounded-lg bg-elevated p-2 font-mono text-[13px] text-neutral-950 dark:text-neutral-100">
            {String(ask.params.command)}
          </div>
        )}
        <Input
          className="rounded-lg border border-border p-2.5 text-[15px] text-neutral-950 dark:text-neutral-100"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…"
          type="password"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2.5">
          <Button onClick={() => onValue('')} variant="outline" size="sm" className="px-2.5 py-1.5">
            <span>Skip</span>
          </Button>
          <Button onClick={() => onValue(text)} className="mt-2 px-[18px] py-[11px]">
            <span className="text-[15px] font-semibold">Send</span>
          </Button>
        </div>
      </>
    );
  };

  // The overlay is deliberately dimmer than a normal sheet's: the user is still
  // meant to be able to read the chat this ask came from.
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
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
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-2xl shadow-lg outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
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
}

/**
 * Themed bottom sheet. Use it directly when the body brings its own scroller
 * (a list), or via FormSheet for a short form.
 */
export function Sheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <SheetChrome open={open} onOpenChange={onOpenChange}>
      {children}
    </SheetChrome>
  );
}

/**
 * Themed bottom sheet for short forms (create/edit). The body is a scroller so
 * a long form cannot push its submit button off the bottom edge.
 */
export function FormSheet({
  open,
  onOpenChange,
  header,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pinned above the scroller so it stays put while the body scrolls. */
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SheetChrome open={open} onOpenChange={onOpenChange}>
      {header}
      <div className={cn(sheetBody, 'pb-8')}>{children}</div>
    </SheetChrome>
  );
}
