// Bottom sheets, as Radix dialogs pinned to the bottom of the viewport.
//
// A sheet is `<Dialog open>`: the parent owns a boolean, and that boolean is
// the single source of truth. The body caps at `max-h-[92vh]` and scrolls.
import { useEffect, useRef, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Check, Copy, Info, KeyRound, Lock, MessageSquare, TriangleAlert, X } from 'lucide-react';
import { parseClarify } from '../../utils/messages';
import { useThemeValue } from '../../hooks/app-store';
import { cn } from '../../utils/cn';
import { screenBg } from '../../theme';
import type { GatewayWs, ServerAsk } from '../../services/gateway-ws';
import { Button } from './button';
import { Input } from './input';
import { ClarifyQuestionnaire } from '../chat/clarify-questionnaire';
import { ApprovalQuestionnaire } from '../chat/approval-questionnaire';

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
  const [cmdCopied, setCmdCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { theme } = useThemeValue();
  const dark = theme === 'dark';
  useEffect(
    () => () => {
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
    const current = askMirror.current;
    const parsed = current?.method === 'clarify' ? parseClarify(current) : null;
    setText(parsed?.single ? (parsed.questions[0]?.lockedAnswer ?? '') : '');
    setCmdCopied(false);
  }, [ask?.rpcId]);

  const renderBody = () => {
    if (!ask) return null;
    const m = ask.method;

    // Batch/single clarify — stepped through as a shadcn Questionnaire (one
    // question per step, pills with letter shortcuts, Send on the last step).
    // The submit shape and the per-question `clarify.lock` live inside
    // ClarifyQuestionnaire; this branch only keeps the sheet's own heading.
    if (m === 'clarify') {
      return (
        <>
          <div className="flex items-center gap-2">
            <MessageSquare size={18} color={dark ? '#f5f5f5' : '#111'} />
            <div className="text-[17px] font-bold text-neutral-950 dark:text-neutral-100">Clarify</div>
          </div>
          <ClarifyQuestionnaire key={ask.rpcId} ask={ask} gw={gw} onResult={onAskResult} />
        </>
      );
    }

    // Dangerous-command approval — the choice list comes from the payload; the
    // rows are a Questionnaire like clarify (label + hint per row, letter
    // shortcuts), but single-shot: tapping answers immediately, no Send step.
    // Payload keys per tools/approval.py: command + description (+ flags).
    if (m === 'approval') {
      const cmd = ask.params.command ? String(ask.params.command) : '';
      const description = ask.params.description ? String(ask.params.description) : '';
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
          <ApprovalQuestionnaire key={ask.rpcId} ask={ask} onApprove={onApproval} />
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
          // Not dismissable by backdrop or Escape — the only casual exit is the
          // dismiss button, which snoozes the sheet while the request stays
          // pending in the Ask Inbox. The parent opens and closes it as `ask`
          // changes. The ask is modal about the *agent*, not about
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
          {/* Dismiss snoozes the sheet, it does not answer: every ask already
              lives in the Ask Inbox (the gateway delivery writes it there
              before the sheet ever opens), so a dismissed request stays
              pending there and can be answered — or re-opened in chat — later.
              This rides the existing onOpenChange(false) path, whose only
              other source is blocked (Escape/backdrop are swallowed above). */}
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Dismiss — answer later from Ask Inbox"
            onClick={() => onOpenChange(false)}
            className="absolute top-3 right-3">
            <X size={16} color={dark ? '#aaa' : '#666'} />
          </Button>
          <div className={cn(sheetBody, 'pr-10')}>{renderBody()}</div>
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
