import type * as React from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Check, Clock, Cog, Copy, Ellipsis, FileText, GitFork, RotateCcw } from 'lucide-react';
import { cleanThinking, flattenLists, renderMediaTags } from '../../utils/messages';
import type { UiMessage } from '../../utils/messages';
import {
  countDiffLineStats,
  diffLineKind,
  inlineDiffFromDetail,
  looksLikeDiff,
  stripInlineDiffChrome,
} from '../../utils/diff';
import { TypingDots } from '../ui/bits';
import { Button } from '../ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '../ui/popover';
import { useLongPress } from '../../hooks/use-long-press';
import type { AnchorMeasure } from './composer';
import { useStreaming } from '../../hooks/app-store';
import { ChatMarkdown } from './markdown';

// Tokens arrive far faster than markdown needs to re-render. Leading + trailing
// throttle: show the first token immediately, then at most one re-parse per
// `ms`, with a guaranteed final flush when the turn settles.
function useThrottledText(text: string, pending: boolean | undefined, ms = 250) {
  const [shown, setShown] = useState(text);
  const latest = useRef(text);
  latest.current = text;
  const flush = useRef<ReturnType<typeof setTimeout> | null>(null);
  const last = useRef(0);
  useEffect(() => {
    if (!pending) {
      if (flush.current) clearTimeout(flush.current);
      flush.current = null;
      last.current = Date.now();
      setShown(text);
      return;
    }
    if (Date.now() - last.current >= ms) {
      last.current = Date.now();
      setShown(text);
      return;
    }
    if (flush.current) return; // a trailing flush is already queued
    flush.current = setTimeout(() => {
      flush.current = null;
      last.current = Date.now();
      setShown(latest.current);
    }, ms);
  }, [text, pending, ms]);
  useEffect(
    () => () => {
      if (flush.current) clearTimeout(flush.current);
    },
    [],
  );
  return shown;
}

// memo(): the transcript re-renders on every streamed token. Without this,
// every bubble's <Markdown> re-parses, so the whole subtree of every bubble was
// torn down and rebuilt ~30x/s. Props must stay referentially stable (see the
// useCallback'd handlers in ChatScreen).
const DIFF_MAX_LINES = 160;

// System monospace on some OEM Android builds (notably Xiaomi/HyperOS) ships
// without Thai glyphs and with broken fallback — Thai text set in `font-mono`
// renders as tofu squares. Detect Thai and fall back to the default UI font
// for those lines (ASCII diffs/tables keep their alignment everywhere else).
// Kept on the web for the same reason: it is a font-availability guess, not a
// platform quirk, and the fallback is harmless where the font is complete.
const hasThai = (s: string) => /[\u0E00-\u0E7F]/.test(s);

// Cached time formatter — `toLocaleTimeString` (Intl) per bubble per render is slow.
let cachedTimeFmt: Intl.DateTimeFormat | null = null;
export function formatBubbleTime(ts: number): string {
  try {
    if (!cachedTimeFmt) {
      cachedTimeFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' });
    }
    return cachedTimeFmt.format(new Date(ts * 1000));
  } catch {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

/** Viewport rect of an element, in the shape the anchor consumers expect. */
function measureOf(el: HTMLElement | null) {
  return (cb: (a: { x: number; y: number; w: number; h: number }) => void) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0) cb({ x: r.x, y: r.y, w: r.width, h: r.height });
  };
}

// Inline unified diff (one row per line so +/- can be tinted; a single element
// can't carry a per-line background). Rows are capped — a huge patch on a
// narrow column is unreadable anyway; the full diff is still on the tool result.
const DiffView = memo(function DiffView({ diff, dark }: { diff: string; dark: boolean }) {
  const lines = useMemo(() => diff.split('\n'), [diff]);
  const shown = lines.length > DIFF_MAX_LINES ? lines.slice(0, DIFF_MAX_LINES) : lines;
  const colorOf = (kind: ReturnType<typeof diffLineKind>): string =>
    kind === 'add'
      ? dark
        ? '#5fd28a'
        : '#1a7f37'
      : kind === 'del'
        ? dark
          ? '#ff8a8a'
          : '#c5221f'
        : kind === 'hunk'
          ? dark
            ? '#7aa7ff'
            : '#1a73e8'
          : kind === 'meta'
            ? dark
              ? '#8b8b8b'
              : '#9ca3af'
            : dark
              ? '#cfcfcf'
              : '#3f3f46';
  const bgOf = (kind: ReturnType<typeof diffLineKind>): string | undefined =>
    kind === 'add'
      ? dark
        ? 'rgba(95,210,138,0.12)'
        : '#e6ffec'
      : kind === 'del'
        ? dark
          ? 'rgba(255,138,138,0.12)'
          : '#ffebe9'
        : undefined;
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-neutral-200/70 dark:border-neutral-700/70">
      {shown.map((line, i) => {
        const kind = diffLineKind(line);
        return (
          <div key={i} style={bgOf(kind) ? { backgroundColor: bgOf(kind) } : undefined}>
            <div
              className={`px-1.5 text-[11px] leading-[15px] ${hasThai(line) ? '' : 'font-mono'}`}
              style={{ color: colorOf(kind) }}>
              {line || ' '}
            </div>
          </div>
        );
      })}
      {lines.length > DIFF_MAX_LINES && (
        <div className="px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
          … {lines.length - DIFF_MAX_LINES} more lines
        </div>
      )}
    </div>
  );
});

// Plain monospace block for a tool RESULT (terminal output, file body, …).
// Capped: a giant dump in a narrow column is unreadable and expensive to lay out.
const OUTPUT_MAX_LINES = 200;

const ToolOutput = memo(function ToolOutput({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const shown = lines.length > OUTPUT_MAX_LINES ? lines.slice(0, OUTPUT_MAX_LINES) : lines;
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-neutral-200/70 bg-black/[0.03] dark:border-neutral-700/70 dark:bg-white/[0.05]">
      {shown.map((l, i) => (
        <div
          key={i}
          className={`px-1.5 text-[11px] leading-[15px] text-neutral-700 dark:text-neutral-300 ${
            hasThai(l) ? '' : 'font-mono'
          }`}>
          {l || ' '}
        </div>
      ))}
      {lines.length > OUTPUT_MAX_LINES && (
        <div className="px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
          … {lines.length - OUTPUT_MAX_LINES} more lines
        </div>
      )}
    </div>
  );
});

// Stable thumbnail — a plain <img> with a fixed src has no identity churn, so
// the memo() below is all that is needed.
const BubbleThumb = memo(function BubbleThumb({ uri, name }: { uri: string; name: string }) {
  return (
    <img
      src={uri}
      alt={name}
      className="h-20 w-20 rounded-lg bg-black/10 object-cover"
      loading="lazy"
      decoding="async"
    />
  );
});

// Stable tap-to-dismiss for plain bubbles — module-level so the memo()'d bubble
// keeps a referentially stable handler.
const dismissKeyboard = () => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
};

export const MessageBubble = memo(function MessageBubble({
  item,
  dark,
  expanded,
  longFired,
  onToggleExpand,
  copied,
  onCopy,
  canRegenerate,
  canBranch,
  onBranchChat,
  onUserMenu,
  onTip,
  onRegenerate,
}: {
  item: UiMessage;
  dark: boolean;
  expanded: boolean;
  longFired: React.MutableRefObject<boolean>;
  onToggleExpand: (id: string) => void;
  /** Boolean, not the copied id: an id prop would re-render every bubble. */
  copied: boolean;
  onCopy: (id: string, text: string) => void;
  /** Rerun the last turn — only on the last assistant bubble. */
  canRegenerate?: boolean;
  /** Per-message ⋯ menu (Branch chat) — assistant bubbles. */
  canBranch?: boolean;
  /** Branch the current session — fired from the ⋯ popover menu. */
  onBranchChat: () => void;
  /** Long-press menu for our own messages (Copy / Edit). */
  onUserMenu: (measure: AnchorMeasure, id: string) => void;
  /** Long-press tooltip for the footer icon buttons. */
  onTip: (measure: AnchorMeasure, label: string) => void;
  onRegenerate: () => void;
}) {
  // Streaming deltas arrive via StreamingContext (not a merged `item` prop),
  // so the list's renderMessage/extraData stay stable per token and only the
  // live bubble's text changes. Other rows keep stable props for memo().
  const streamingTexts = useStreaming();
  const streamDelta = streamingTexts[item.id] ?? '';
  const mergedText = streamDelta ? item.text + streamDelta : item.text;
  // The streaming bubble changes on every token — see useThrottledText().
  const liveText = useThrottledText(mergedText, item.pending);
  // `MEDIA:<path>` is the agent's attachment contract — assistant replies only
  // (a user quoting the tag shouldn't turn into an image).
  const body = useMemo(
    () => flattenLists(item.role === 'assistant' ? renderMediaTags(liveText) : liveText),
    [liveText, item.role],
  );
  // While streaming, render plain text: a full markdown re-parse per token
  // rebuilds the whole subtree (~30x/s) — the main jank source. Plain updates
  // are cheap; markdown is parsed once when the turn settles. Same 15px/21px
  // metrics, so no size jump. Exception: replies carrying MEDIA: tags keep the
  // markdown path so attachments render as images instead of raw tags mid-stream.
  const streamPlain = item.role === 'assistant' && !!item.pending && !liveText.includes('MEDIA:');
  const think = item.role === 'thinking';
  const typing = !think && item.pending && !mergedText;
  const markdown =
    !think && item.role !== 'notice' && item.role !== 'interim' && item.role !== 'tool' && item.role !== 'summary';
  const copyable = (item.role === 'user' || item.role === 'assistant') && !!mergedText && !item.pending;
  // A file-editing tool: the gateway renders the diff onto the live bubble, or
  // it rides inside the REST tool result JSON (history). Render either inline.
  const toolDiff = useMemo(
    () =>
      item.role === 'tool'
        ? item.diff
          ? stripInlineDiffChrome(item.diff)
          : inlineDiffFromDetail(item.output) || inlineDiffFromDetail(item.detail)
        : '',
    [item.role, item.diff, item.output, item.detail],
  );
  const toolStats = useMemo(() => countDiffLineStats(toolDiff), [toolDiff]);
  // Anchors for the long-press tooltips on the copy/regenerate footer icons
  // (same measurer shape as Composer).
  const copyAnchor = useRef<HTMLSpanElement | null>(null);
  const regenAnchor = useRef<HTMLSpanElement | null>(null);
  // Tooltip peek fired on a footer icon: swallow the click that fires on
  // release, so peeking at the label doesn't also trigger the action.
  const tipFired = useRef(false);
  const fireTip = useCallback(
    (el: HTMLElement | null, label: string) => {
      tipFired.current = true;
      onTip(measureOf(el), label);
    },
    [onTip],
  );
  // Stable press handlers — inline arrows here would break memo() and force a
  // markdown re-parse on every streamed token.
  const handleCopyClick = useCallback(() => {
    if (tipFired.current) {
      tipFired.current = false;
      return;
    }
    onCopy(item.id, mergedText);
  }, [onCopy, item.id, mergedText]);
  const handleRegenClick = useCallback(() => {
    if (tipFired.current) {
      tipFired.current = false;
      return;
    }
    onRegenerate();
  }, [onRegenerate]);
  const handleCopyTip = useCallback(() => fireTip(copyAnchor.current, copied ? 'Copied!' : 'Copy'), [fireTip, copied]);
  const handleRegenTip = useCallback(() => fireTip(regenAnchor.current, 'Regenerate'), [fireTip]);
  // Whole-bubble anchor for the long-press menu on our own messages.
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const handleToggleClick = useCallback(() => {
    if (longFired.current) {
      longFired.current = false;
      return;
    }
    onToggleExpand(item.id);
  }, [onToggleExpand, item.id, longFired]);
  const handleToggleLongPress = useCallback(() => {
    longFired.current = true;
  }, [longFired]);
  const handleUserLongPress = useCallback(() => {
    onUserMenu(measureOf(bubbleRef.current), item.id);
  }, [onUserMenu, item.id]);
  // Expand/collapse lives on the root for thinking + tool output: the press
  // must sit on an ANCESTOR of the text so taps anywhere (text included)
  // toggle. These two roles never render footer pressables, so there is no
  // nested-pressable conflict; other roles get an inert root and keep their
  // inner pressables untouched.
  const toggleable = think || item.role === 'tool';
  // All four gestures are wired up here, unconditionally and before any of the
  // conditional branches in the JSX below. `useLongPress` was originally spread
  // straight into the footer buttons, which put a hook call inside a
  // `{copyable && ...}` branch — fine until one bubble renders a footer and the
  // next does not, and then hook order changes between renders of the same
  // component.
  const userLongPress = useLongPress(handleUserLongPress, { delay: 400 });
  const toggleLongPress = useLongPress(handleToggleLongPress, { delay: 400 });
  const copyLongPress = useLongPress(handleCopyTip, { delay: 400 });
  const regenLongPress = useLongPress(handleRegenTip, { delay: 400 });
  return (
    <div
      ref={bubbleRef}
      className={`rounded-[14px] px-3 py-2 ${
        item.role === 'user'
          ? 'self-end bg-[#e5e7eb] dark:bg-[#3f3f46]'
          : think
            ? 'self-start border border-[#e2e2e6] bg-[#f7f7f9] dark:border-neutral-700 dark:bg-[#212121]'
            : item.role === 'interim'
              ? 'self-start border border-[#f0e0a0] bg-[#fff8e1] dark:border-[#6b5a1e] dark:bg-[#3a2f10]'
              : item.role === 'notice'
                ? 'self-center bg-[#fdecea] dark:bg-[#3d2020]'
                : item.role === 'tool'
                  ? 'self-start border border-[#d3e1f8] bg-[#eef3fd] dark:border-neutral-700 dark:bg-[#272727]'
                  : item.role === 'summary'
                    ? 'self-start bg-transparent'
                    : 'self-start bg-[#f0f0f2] dark:bg-[#272727]'
      }`}
      // 85% of the *content column*, not the window, so a long row (a thinking
      // summary, a tool card) can never spill past the column and drag a
      // horizontal scrollbar across the transcript.
      style={{ maxWidth: '85%' }}
      role={toggleable ? 'button' : undefined}
      aria-label={toggleable ? `${expanded ? 'Collapse' : 'Expand'} ${think ? 'thinking' : 'tool output'}` : undefined}
      aria-expanded={toggleable ? expanded : undefined}
      onClick={toggleable ? handleToggleClick : dismissKeyboard}
      {...(toggleable ? toggleLongPress : {})}>
      {typing ? (
        <TypingDots />
      ) : think ? (
        mergedText ? (
          <div className="flex gap-1.5">
            {/* Icon is 14px but a text line is 18px tall — center it inside a
                line-height box so it lines up with the first line's glyphs
                instead of riding the top of the line box. */}
            <div className="flex h-[18px] items-center">
              <Brain size={14} color={dark ? '#999' : '#777'} />
            </div>
            <div
              className={`shrink text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400 ${expanded ? '' : 'truncate'}`}>
              {cleanThinking(mergedText)}
            </div>
          </div>
        ) : (
          <TypingDots dim />
        )
      ) : item.role === 'tool' ? (
        <>
          <div className="flex gap-1.5">
            {/* Same line-height box as the thinking bubble: the 14px icon
                centers against the first 18px text line. */}
            <div className="flex h-[18px] items-center">
              {item.pending ? (
                <Cog size={14} color={dark ? '#8fa8ff' : '#3b5bdb'} />
              ) : (
                <Check size={14} color={dark ? '#8fa8ff' : '#3b5bdb'} />
              )}
            </div>
            <div
              className={`shrink text-[13px] leading-[18px] text-[#3b5bdb] dark:text-[#8fa8ff] ${expanded ? '' : 'line-clamp-2'}`}>
              {mergedText}
            </div>
            {!!toolDiff && (
              // A <span> wrapper, not a nested Text: the outer element is a div
              // and a div inside a div would break the run of added/removed
              // counts onto separate lines.
              <span className="shrink-0 text-[11px] font-semibold leading-[18px]">
                <span className="text-[#1a7f37] dark:text-[#5fd28a]">＋{toolStats.added}</span>{' '}
                <span className="text-[#c5221f] dark:text-[#ff8a8a]">−{toolStats.removed}</span>
              </span>
            )}
          </div>
          {expanded && (
            <>
              {!!item.command && (
                <div className="mt-1 overflow-hidden rounded-lg border border-neutral-200/70 bg-neutral-100/60 dark:border-neutral-700/70 dark:bg-white/[0.05]">
                  <div className="px-1.5 py-1 font-mono text-[11px] leading-[15px] text-neutral-600 dark:text-neutral-300">
                    {item.command}
                  </div>
                </div>
              )}
              {!!item.output && !(!!toolDiff && looksLikeDiff(item.output)) && <ToolOutput text={item.output} />}
              {!!toolDiff && <DiffView diff={toolDiff} dark={dark} />}
              {!item.output && !toolDiff && !item.command && !!item.detail && (
                <div className="mt-1 text-[12px] leading-[17px] text-neutral-600 dark:text-neutral-300">
                  {item.detail}
                </div>
              )}
              {!item.output && !toolDiff && !item.command && !item.detail && !item.pending && (
                <div className="mt-1 text-[11px] italic text-neutral-400 dark:text-neutral-500">no result captured</div>
              )}
            </>
          )}
        </>
      ) : item.role === 'summary' ? (
        <div className="flex items-center gap-1.5">
          <FileText size={12} color={dark ? '#777' : '#999'} />
          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{mergedText}</div>
        </div>
      ) : markdown ? (
        item.role === 'user' ? (
          // Long-press our own message for the Copy / Edit menu. The root above
          // already handles the click, so this wrapper only adds the gesture.
          <div {...userLongPress} className="cursor-default">
            {!!item.media?.length && (
              <div className="mb-1 flex flex-wrap gap-1.5">
                {item.media.map((a) => (
                  <BubbleThumb key={a.uri + a.name} uri={a.uri} name={a.name} />
                ))}
              </div>
            )}
            {!!liveText && <ChatMarkdown body={body} theme="user" dark={dark} />}
          </div>
        ) : (
          <>
            {!!item.media?.length && (
              <div className="mb-1 flex flex-wrap gap-1.5">
                {item.media.map((a) => (
                  <BubbleThumb key={a.uri + a.name} uri={a.uri} name={a.name} />
                ))}
              </div>
            )}
            {!!liveText &&
              (streamPlain ? (
                <div className="text-[15px] leading-[21px] text-neutral-950 dark:text-neutral-100">{liveText}</div>
              ) : (
                <ChatMarkdown body={body} theme="ai" dark={dark} />
              ))}
          </>
        )
      ) : (
        <div className="text-[15px] leading-[21px] text-neutral-950 dark:text-neutral-100">{mergedText}</div>
      )}
      {/* Footer: bot time lives in its ⋯ menu, ours in the long-press menu —
          copy icon stays on bot bubbles only. */}
      {((copyable && item.role !== 'user') || canRegenerate || canBranch) && (
        <div className="mt-1 flex items-center gap-3 self-end">
          {copyable && item.role !== 'user' && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCopyClick}
              aria-label={copied ? 'Copied' : 'Copy'}
              className="h-6 w-6"
              {...copyLongPress}>
              <span ref={copyAnchor}>
                {copied ? (
                  <Check size={12} color={dark ? '#aaa' : '#999'} />
                ) : (
                  <Copy size={12} color={dark ? '#aaa' : '#999'} />
                )}
              </span>
            </Button>
          )}
          {canRegenerate && (
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRegenClick}
              aria-label="Regenerate"
              className="h-6 w-6"
              {...regenLongPress}>
              <span ref={regenAnchor}>
                <RotateCcw size={12} color={dark ? '#aaa' : '#999'} />
              </span>
            </Button>
          )}
          {canBranch && (
            // No long-press tooltip here (unlike copy/regenerate): the trigger
            // toggles the popover on click, so a tooltip peek would also pop the
            // menu open. The a11y label carries the meaning.
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More actions" className="h-6 w-6">
                  <Ellipsis size={12} color={dark ? '#aaa' : '#999'} />
                </Button>
              </PopoverTrigger>
              <PopoverContent side="top" align="end" className="p-1.5">
                {!!item.ts && (
                  <div className="flex items-center gap-2.5 px-3 py-2">
                    <Clock size={17} color={dark ? '#888' : '#999'} />
                    <div className="text-[13px] text-neutral-500 dark:text-neutral-400">
                      {formatBubbleTime(item.ts)}
                    </div>
                  </div>
                )}
                <PopoverClose asChild>
                  <Button
                    variant="ghost"
                    data-testid="menu-branch"
                    onClick={onBranchChat}
                    className="w-full items-center justify-start gap-2.5 px-3 py-2.5">
                    <GitFork size={17} color={dark ? '#aaa' : '#999'} />
                    <span className="text-[15px]">Branch chat</span>
                  </Button>
                </PopoverClose>
              </PopoverContent>
            </Popover>
          )}
        </div>
      )}
    </div>
  );
});
