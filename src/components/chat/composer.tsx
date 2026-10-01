import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Paperclip, Plus, Square, X } from 'lucide-react';

import type { Attachment } from '../../utils/messages';
import { reasoningLabel } from '../../utils/reasoning';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Text as UIText } from '../ui/text';

// How a control reports its position for a screen-level popover. The popover
// lives in the chat screen (not here) so it can float above the list and still
// receive taps. ChatScreen re-invokes the measure fn when the layout shifts
// (keyboard).
export type AnchorRect = { x: number; y: number; w: number; h: number };
export type AnchorMeasure = (cb: (a: AnchorRect) => void) => void;

/**
 * Viewport rect of the anchored element. This is what replaced
 * `View.measureInWindow`; the shape is unchanged so every consumer — the model
 * picker, the effort picker, the attach picker, the long-press menus — keeps
 * working without knowing which platform it is on.
 */
const measurer = (el: HTMLElement | null): AnchorMeasure => (cb) => {
  if (!el) return;
  const r = el.getBoundingClientRect();
  cb({ x: r.x, y: r.y, w: r.width, h: r.height });
};

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
  onOpenEffortPicker,
  onOpenAttachPicker,
  attachments,
  setAttachments,
  dark,
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
  onOpenEffortPicker: (measure: AnchorMeasure) => void;
  onOpenAttachPicker: (measure: AnchorMeasure) => void;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
  /** Theme comes in as a prop — a store subscription here would defeat memo(). */
  dark: boolean;
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const effortRef = useRef<HTMLButtonElement>(null);

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

  // Mobile browsers do not resize the layout for the virtual keyboard, so the
  // composer would sit under it. `visualViewport` reports the shrunken height
  // directly; the gap between it and the layout viewport is the keyboard.
  const [webKb, setWebKb] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const gap = window.innerHeight - vv.height - (vv.offsetTop ?? 0);
      setWebKb(Math.max(0, Math.round(gap)));
    };
    onResize();
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const trimmedInput = input.trim();
  const hasText = trimmedInput.length > 0;
  const modelLabel = modelProvider ? `${modelProvider}:${model}` : model;
  return (
    <div
      className="px-2.5 pt-2"
      style={{
        // Above the keyboard when one is up, otherwise clear of the home
        // indicator. `env()` beats a measured inset here — no layout pass.
        paddingBottom: webKb > 0 ? webKb + 18 : 'max(env(safe-area-inset-bottom, 0px), 10px)',
      }}>
      <div className="flex flex-col gap-1.5 rounded-2xl border border-neutral-200/80 bg-[#f4f4f6] px-3 pb-2 pt-2 dark:border-neutral-700/70 dark:bg-[#212121]">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a) => {
              const isImg =
                (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name);
              return (
                <Button
                  key={a.uri + a.name}
                  variant="secondary"
                  size="sm"
                  onClick={() => setAttachments(attachments.filter((x) => x.uri !== a.uri))}
                  className="max-w-[220px] gap-1 px-2 py-1 shadow-none">
                  {isImg ? (
                    <img
                      src={a.uri}
                      alt={a.name}
                      className="h-7 w-7 rounded-md bg-[#d7e3f7] object-cover"
                    />
                  ) : (
                    <Paperclip size={12} color="#1a73e8" />
                  )}
                  <UIText
                    numberOfLines={1}
                    className="min-w-0 shrink text-left text-xs text-[#1a73e8] dark:text-[#7aa7ff]">
                    {a.name}
                  </UIText>
                  <X size={12} color="#1a73e8" />
                </Button>
              );
            })}
          </div>
        )}
        <Textarea
          ref={inputRef}
          aria-label="Message"
          // The container draws the border and background; the field itself is
          // transparent, or it reads as a frame inside a frame.
          className="max-h-[180px] min-h-[64px] border-0 bg-transparent px-1.5 py-2.5 text-[15px] text-neutral-950 shadow-none focus-visible:ring-0 dark:text-neutral-100"
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
          placeholder={
            generating ? 'Type to steer the running turn' : 'Ask anything, / for commands, @ for context…'
          }
          style={{ colorScheme: dark ? 'dark' : 'light' }}
          onBlur={handleBlur}
        />
        {/* The model chip is the only shrinkable item: without it the row (plus
            + chip + effort + Steer + stop/send) is wider than a phone screen and
            spills past the right edge. It has no max-width on purpose - flex
            shrink already caps it on a phone, and a cap here would also clip the
            name on a wide screen where there is nothing to protect against. */}
        <div className="flex items-center gap-1.5">
          <Button
            ref={plusRef}
            variant="ghost"
            size="icon"
            aria-label="Attach"
            onClick={() => onOpenAttachPicker(measurer(plusRef.current))}
            className="h-8 w-8 shrink-0 shadow-none">
            <Plus size={20} color={dark ? '#a3a3a3' : '#555'} />
          </Button>
          <Button
            ref={modelRef}
            variant="ghost"
            size="sm"
            onClick={() => onOpenModelPicker(measurer(modelRef.current))}
            className="min-w-0 shrink gap-1 px-1.5 py-1.5 shadow-none">
            <span className="flex min-w-0 shrink items-center gap-0.5">
              <UIText
                numberOfLines={1}
                className="min-w-0 shrink text-left text-[13px] font-semibold text-neutral-700 dark:text-neutral-200">
                {modelLabel}
              </UIText>
              <ChevronDown size={14} color={dark ? '#a3a3a3' : '#666'} />
            </span>
          </Button>
          {showEffort && (
            <Button
              ref={effortRef}
              variant="ghost"
              size="sm"
              onClick={() => onOpenEffortPicker(measurer(effortRef.current))}
              className="shrink-0 px-2 py-1.5 shadow-none">
              <UIText className="text-[13px] font-semibold text-neutral-500 dark:text-neutral-400">
                {reasoningLabel(effort, effortWire)}
              </UIText>
            </Button>
          )}
          <div className="flex-1" />
          {generating ? (
            <>
              {hasText && !attachments.length && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onQueue(input)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 shadow-none">
                  <UIText className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                    Queue
                  </UIText>
                </Button>
              )}
              {hasText && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRedirect(input)}
                  className="shrink-0 rounded-lg px-2 py-1.5 shadow-none">
                  <UIText className="text-[13px] font-semibold dark:text-neutral-100">Steer ↪</UIText>
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
      </div>
    </div>
  );
});
