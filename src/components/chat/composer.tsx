import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Paperclip, Plus, ShieldCheck, ShieldOff, ShieldUser, Square, X } from 'lucide-react';

import type { Attachment } from '../../utils/messages';
import { reasoningLabel } from '../../utils/reasoning';
import { Button } from '../ui/button';
import { DropdownMenuTrigger, type DropdownMenuHandle } from '../ui/dropdown-menu';
import { Textarea } from '../ui/textarea';

// How a control reports its position for a screen-level popover. The popover
// lives in the chat screen (not here) so it can float above the list and still
// receive taps. ChatScreen re-invokes the measure fn when the layout shifts
// (keyboard).
//
// One caller left: the model picker. The attach and effort menus used to go
// through here too, and moved to detached `DropdownMenuTrigger`s — Base UI
// portals its popup to `body`, so the Android reason for keeping the body on the
// screen no longer applies, and a menu can anchor itself. The model picker stays
// measured because it is not a menu (see the note on it in the chat screen).
export type AnchorRect = { x: number; y: number; w: number; h: number };
export type AnchorMeasure = (cb: (a: AnchorRect) => void) => void;

/**
 * Viewport rect of the anchored element. This is what replaced
 * `View.measureInWindow`; the shape is unchanged so every consumer — the model
 * picker, the effort picker, the attach picker, the long-press menus — keeps
 * working without knowing which platform it is on.
 */
const measurer =
  (el: HTMLElement | null): AnchorMeasure =>
  (cb) => {
    // The model chip is swapped for a second copy when the keyboard lifts the
    // composer, so the element captured at tap time can be detached by the time
    // the popover re-measures. Look up the one that is on screen instead.
    const live = el?.isConnected ? el : document.querySelector<HTMLElement>('[data-model-chip]');
    if (!live) return;
    const r = live.getBoundingClientRect();
    cb({ x: r.x, y: r.y, w: r.width, h: r.height });
  };

// Model + effort picker row, shared by the expanded footer and the collapsed
// pill so the two never drift apart. Owns its own anchor ref.
const ModelRow = memo(function ModelRow({
  modelLabel,
  onOpenModelPicker,
  effort,
  effortWire,
  showEffort,
  effortMenu,
  dark,
}: {
  modelLabel: string;
  onOpenModelPicker: (measure: AnchorMeasure) => void;
  effort: string;
  effortWire?: string;
  showEffort: boolean;
  effortMenu: DropdownMenuHandle;
  dark: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={btnRef}
        data-model-chip
        variant="ghost"
        size="sm"
        onClick={() => onOpenModelPicker(measurer(btnRef.current))}
        className="min-w-0 shrink gap-1 px-1.5 py-1.5 shadow-none">
        <span className="flex min-w-0 shrink items-center gap-0.5">
          <span className="min-w-0 shrink text-left text-[13px] font-semibold text-neutral-700 dark:text-neutral-200 truncate">
            {modelLabel}
          </span>
          <ChevronDown size={14} color={dark ? '#a3a3a3' : '#666'} />
        </span>
      </Button>
      {showEffort && (
        <DropdownMenuTrigger
          handle={effortMenu}
          id="effort"
          render={<Button variant="ghost" size="sm" className="shrink-0 px-2 py-1.5 shadow-none" />}>
          <span className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400">
            {reasoningLabel(effort, effortWire)}
          </span>
        </DropdownMenuTrigger>
      )}
    </>
  );
});

// memo(): every streamed token re-renders the chat screen. Without this the
// focused textarea re-renders ~30x/s, which drops focus and caret position
// mid-draft. All props must therefore be referentially stable — see the
// useCallback'd handlers in ChatScreen and send() in the store.
export const Composer = memo(function Composer({
  input,
  setInput,
  send,
  stop,
  onRedirect,
  onQueue,
  onPasteLarge,
  generating,
  model,
  modelProvider,
  onOpenModelPicker,
  effort,
  effortWire,
  showEffort,
  attachMenu,
  effortMenu,
  attachments,
  setAttachments,
  dark,
  stackModel,
  keyboardUp,
  approvalMode,
  onCycleApproval,
}: {
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  stop: () => void;
  onRedirect: (text: string) => void;
  /** Hold the draft for the next turn while one is running. */
  onQueue: (text: string) => void;
  /** Spill a large paste to a server file instead of inlining it. */
  onPasteLarge: (text: string) => void;
  generating: boolean;
  model: string;
  modelProvider: string;
  onOpenModelPicker: (measure: AnchorMeasure) => void;
  effort: string;
  /** Wire level the route actually sends (clamp display, e.g. Ultra→Max). */
  effortWire?: string;
  /** Hidden when the current model reports no reasoning support. */
  showEffort: boolean;
  /**
   * Detached menu handles. The triggers are the buttons below; the bodies live
   * on the chat screen, which is where the data they read lives. Base UI anchors
   * each popup to whichever trigger opened it, so nothing here has to measure.
   */
  attachMenu: DropdownMenuHandle;
  effortMenu: DropdownMenuHandle;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
  /** Theme comes in as a prop — a store subscription here would defeat memo(). */
  dark: boolean;
  /** Narrow screen: model + effort drop to their own row below the icon row,
      like OpenChamber's mobile composer, so the action row stays roomy. */
  stackModel: boolean;
  /** Keyboard is up (visual-viewport gap). On narrow screens the composer is
      a collapsed pill while it is down, and expands on tap. */
  keyboardUp: boolean;
  /** Dangerous-command approval mode + cycler (the shield in the footer). */
  approvalMode: 'manual' | 'smart' | 'off';
  onCycleApproval: () => void;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Collapsed pill on narrow screens while the keyboard is down: tapping the
  // preview expands and focuses the field.
  //
  // `tapExpand` is a latch, not a transient. It used to be cleared the instant
  // focus was requested, which collapsed the pill again before the keyboard
  // finished coming up — and on a device that never raises one (a desktop
  // browser narrowed under 768px) it collapsed instantly, so the tap did
  // nothing visible. It clears when the field reports focus (so the keyboard
  // owns the state from then on) or when the keyboard is dismissed.
  const [tapExpand, setTapExpand] = useState(false);
  const [focused, setFocused] = useState(false);
  const expanded = !stackModel || keyboardUp || focused || tapExpand || attachments.length > 0;
  // Ask for focus on the tap itself, not in an effect: iOS only raises the soft
  // keyboard while a gesture is still live, and an effect runs after it.
  //
  // The field is only mounted once expanded, so on the very first tap the ref is
  // still null and the focus request lands on nothing — the pill expands, but
  // typing needs a second tap. Focus the field the moment it attaches instead;
  // `tapExpand` is what says the user asked for it, so this only ever happens
  // after a deliberate expand and never steals focus on its own.
  useEffect(() => {
    if (!tapExpand) return;
    inputRef.current?.focus();
  }, [tapExpand, expanded]);
  const expand = useCallback(() => {
    setTapExpand(true);
    inputRef.current?.focus();
  }, []);
  // The field took focus, so `focused` carries the state from here.
  //
  // `keyboardUp` is what *replaces* the latch, not focus: focus leaves the field
  // for every sibling control (model chip, effort, approvals, attach) and for
  // the sheet's own autofocus, so treating blur as "collapse" made the composer
  // fold away under the user's thumb every time they touched any other button in
  // it. The keyboard going down is the real signal that they are done.
  useEffect(() => {
    if (keyboardUp) setTapExpand(false);
  }, [keyboardUp]);
  // Shield glyph per approval mode, like OpenChamber's permission button:
  // manual asks every time, smart lets the model decide, off runs everything.
  const ApprovalIcon = approvalMode === 'off' ? ShieldOff : approvalMode === 'smart' ? ShieldCheck : ShieldUser;
  const approvalColor =
    approvalMode === 'off'
      ? dark
        ? '#f0b429'
        : '#d97706'
      : approvalMode === 'smart'
        ? 'var(--brand-hex)'
        : dark
          ? '#a3a3a3'
          : '#555';
  const approvalLabel =
    approvalMode === 'off'
      ? 'Approvals off — run everything'
      : approvalMode === 'smart'
        ? 'Smart approvals — model decides'
        : 'Manual approvals — ask every time';

  // While a turn streams, something outside the composer (a portal teardown, a
  // re-render) can drop focus out of the text field mid-draft — the user has to
  // click back in. If nothing else claimed focus, take it back. A deliberate
  // click on a button or another input leaves THAT element focused, so this
  // never fights the user.
  const handleBlur = useCallback(() => {
    if (!generating) return;
    requestAnimationFrame(() => {
      const node = inputRef.current;
      const active = document.activeElement;
      if (!node || (active && active !== document.body)) return;
      node.focus();
    });
  }, [generating]);

  // The virtual keyboard is handled by the chat screen's footer, which owns the
  // whole bottom block: it pads itself by `kbH` (visual-viewport gap) and the
  // transcript reserves room from its measured height. This component must NOT
  // also pad for the keyboard — it used to, and the two lifts stacked, so the
  // card rose roughly twice the keyboard height and looked like it floated off.
  // All that belongs here is clearance for the home indicator.
  const trimmedInput = input.trim();
  const hasText = trimmedInput.length > 0;
  const modelLabel = modelProvider ? `${modelProvider}:${model}` : model;
  const placeholder = generating ? 'Type to steer the running turn' : 'Ask anything, / for commands, @ for context…';
  return (
    <div
      // `pointer-events-auto` is load-bearing and is the counterpart to the
      // `pointer-events-none` on the chat screen's overlay footer, which owns
      // this whole band. The footer must be transparent to gestures so the
      // transcript underneath still scrolls; the composer inside it must be
      // opaque, or the send button and the text field stop responding.
      className="pointer-events-auto px-2.5 pt-2"
      style={{
        // Only the home-indicator clearance lives here; the keyboard lift is the
        // footer's job (see the note above). `env()` beats a measured inset —
        // no layout pass.
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 10px)',
      }}>
      <div
        className="frame-focus glass-composer flex flex-col gap-1.5 rounded-3xl border border-border/80 px-3 pb-2 pt-2"
        // Keep the field focused when a composer CONTROL is tapped. On mobile the
        // blur dismisses the keyboard, which drops `keyboardUp` and shifts the
        // composer down under the finger — the tap then lands off the button, so
        // menus never opened and Send needed two presses. Suppressing the
        // mousedown focus shift for buttons only leaves the textarea's own
        // tap-to-focus untouched.
        onMouseDownCapture={(e) => {
          if ((e.target as Element).closest('button')) e.preventDefault();
        }}>
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a) => {
              const isImg = (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name);
              return (
                <Button
                  key={a.uri + a.name}
                  variant="secondary"
                  size="sm"
                  onClick={() => setAttachments(attachments.filter((x) => x.uri !== a.uri))}
                  className="max-w-[220px] gap-1 px-2 py-1 shadow-none">
                  {isImg ? (
                    <img src={a.uri} alt={a.name} className="h-7 w-7 rounded-md bg-[#d7e3f7] object-cover" />
                  ) : (
                    <Paperclip size={12} color="var(--brand-hex)" />
                  )}
                  <span className="min-w-0 shrink text-left text-xs text-brand truncate">{a.name}</span>
                  <X size={12} color="var(--brand-hex)" />
                </Button>
              );
            })}
          </div>
        )}
        {/* Collapsed pill on narrow screens: one tappable line instead of the
            field + icon row. Tapping expands and focuses the field. */}
        {expanded ? (
          <>
            <Textarea
              ref={inputRef}
              aria-label="Message"
              // The container draws the border and background; the field itself is
              // transparent, or it reads as a frame inside a frame.
              className="max-h-[180px] min-h-[64px] resize-none border-0 bg-transparent px-1.5 py-2.5 text-[15px] text-neutral-950 shadow-none focus-visible:ring-0 dark:bg-transparent dark:text-neutral-100"
              value={input}
              onChange={(e) => {
                const t = e.target.value;
                // A big paste (multi-line wall) is spilled to a server file so it
                // doesn't bloat the prompt; the placeholder names the file the agent
                // can read.
                if (t.length - input.length > 1500) {
                  onPasteLarge(t);
                  return;
                }
                setInput(t);
              }}
              placeholder={placeholder}
              style={{ colorScheme: dark ? 'dark' : 'light' }}
              onBlur={() => {
                setFocused(false);
                handleBlur();
                // Tapping the transcript dismisses the keyboard (its scroller's own
                // handler) and the field blurs, but nothing tells the keyboard to go
                // away — on Android the soft keyboard can stay up with nothing
                // focused. The pill is meant to come back the moment the field is
                // dismissed, and the blur is that signal, so drop the latch here too.
                // Blur from a *sibling control* is filtered out by the delay check:
                // focus is still inside the box, so the composer is untouched.
                window.setTimeout(() => {
                  const el = inputRef.current;
                  const active = document.activeElement;
                  if (el && active !== el && !el.closest('.frame-focus')?.contains(active)) setTapExpand(false);
                }, 120);
              }}
              onFocus={() => setFocused(true)}
            />
            {/* Narrow screens wrap the model row below the icon row (see
            stackModel): the action row keeps full width for Queue/Steer/send
            instead of squeezing beside the model name. */}
            <div className="flex flex-wrap items-center gap-1.5">
              <DropdownMenuTrigger
                handle={attachMenu}
                id="attach"
                render={
                  <Button variant="ghost" size="icon" aria-label="Attach" className="h-8 w-8 shrink-0 shadow-none" />
                }>
                <Plus size={20} color={dark ? '#a3a3a3' : '#555'} />
              </DropdownMenuTrigger>
              <Button
                variant="ghost"
                size="icon"
                onClick={onCycleApproval}
                aria-label={approvalLabel}
                title={approvalLabel}
                className="h-8 w-8 shrink-0 shadow-none">
                <ApprovalIcon size={20} color={approvalColor} />
              </Button>
              {/* basis-full + order pushes model/effort onto their own row when
              stacked; inline and shrinkable otherwise. */}
              <div className={`flex min-w-0 items-center gap-1 ${stackModel ? 'order-3 basis-full' : 'shrink'}`}>
                <ModelRow
                  modelLabel={modelLabel}
                  onOpenModelPicker={onOpenModelPicker}
                  effort={effort}
                  effortWire={effortWire}
                  showEffort={showEffort}
                  effortMenu={effortMenu}
                  dark={dark}
                />
              </div>
              <div className="flex-1" />
              {generating ? (
                <>
                  {hasText && !attachments.length && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onQueue(input)}
                      className="shrink-0 rounded-lg px-2.5 py-1.5 shadow-none">
                      <span className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">Queue</span>
                    </Button>
                  )}
                  {hasText && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onRedirect(input)}
                      className="shrink-0 rounded-lg px-2 py-1.5 shadow-none">
                      <span className="text-[13px] font-semibold dark:text-neutral-100">Steer ↪</span>
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={stop}
                    aria-label="Stop"
                    className="h-9 w-9 shrink-0 rounded-full shadow-none">
                    <Square size={13} color="#fff" fill="#fff" />
                  </Button>
                </>
              ) : (
                <Button
                  variant="default"
                  size="icon"
                  onClick={send}
                  aria-label="Send"
                  className="h-9 w-9 shrink-0 rounded-full shadow-none">
                  <ArrowUp size={19} color={dark ? '#111' : '#fff'} />
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex h-12 min-w-0 items-center gap-0.5 pl-1 pr-1">
              <DropdownMenuTrigger
                handle={attachMenu}
                id="attach"
                render={
                  <Button variant="ghost" size="icon" aria-label="Attach" className="h-8 w-8 shrink-0 shadow-none" />
                }>
                <Plus size={20} color={dark ? '#a3a3a3' : '#555'} />
              </DropdownMenuTrigger>
              <button
                type="button"
                aria-label="Expand composer"
                className="flex h-full min-w-0 flex-1 cursor-text items-center px-1.5 text-left"
                onClick={expand}>
                <span
                  className={`truncate text-[15px] ${hasText ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-500'}`}>
                  {hasText ? input : placeholder}
                </span>
              </button>
              {generating ? (
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={stop}
                  aria-label="Stop"
                  className="h-9 w-9 shrink-0 rounded-full shadow-none">
                  <Square size={13} color="#fff" fill="#fff" />
                </Button>
              ) : (
                <Button
                  variant="default"
                  size="icon"
                  onClick={send}
                  aria-label="Send"
                  disabled={!hasText}
                  className="h-9 w-9 shrink-0 rounded-full shadow-none disabled:opacity-40">
                  <ArrowUp size={19} color={dark ? '#111' : '#fff'} />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-1 px-1.5 pb-1.5">
              <ModelRow
                modelLabel={modelLabel}
                onOpenModelPicker={onOpenModelPicker}
                effort={effort}
                effortWire={effortWire}
                showEffort={showEffort}
                effortMenu={effortMenu}
                dark={dark}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
});
