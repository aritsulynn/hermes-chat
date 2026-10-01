import type * as React from 'react';
import { memo, useCallback, useMemo, useRef } from 'react';
import { Brain, Check, Clock, Cog, Copy, Ellipsis, FileText, GitFork, RotateCcw } from 'lucide-react';
import { cleanThinking, renderMediaTags, splitSettled } from '../../utils/messages';
import type { Role, UiMessage } from '../../utils/messages';
import {
  countDiffLineStats,
  diffLineKind,
  inlineDiffFromDetail,
  looksLikeDiff,
  stripInlineDiffChrome,
} from '../../utils/diff';
import { TypingDots } from '../ui/bits';
import { Button } from '../ui/button';
import { Bubble, BubbleContent } from '../ui/bubble';
import { Message, MessageContent } from '../ui/message';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useLongPress } from '../../hooks/use-long-press';
import type { AnchorMeasure } from './composer';
import { useStreamingText } from '../../hooks/app-store';
import { ChatMarkdown } from './markdown';
import { useSmoothText } from './use-smooth-text';

// The streamed body is revealed on a steady cadence rather than as it arrives —
// see components/chat/use-smooth-text.ts. That is what makes streaming look like
// a normal chat instead of arriving in clumps.
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

// Transcript role -> Bubble variant. The two vocabularies are the same on
// purpose: the colours themselves live in the vendored bubble.tsx beside
// shadcn's own palette, and this Record is what stops a role being added to
// `Role` without a surface to draw it on.
const BUBBLE_VARIANT: Record<Role, 'user' | 'assistant' | 'thinking' | 'interim' | 'notice' | 'tool' | 'summary'> = {
  user: 'user',
  assistant: 'assistant',
  thinking: 'thinking',
  interim: 'interim',
  notice: 'notice',
  tool: 'tool',
  summary: 'summary',
};

// memo(): the transcript re-renders on every streamed token. Without this,
// every bubble's <Markdown> re-parses, so the whole subtree of every bubble was
// torn down and rebuilt ~30x/s. Props must stay referentially stable (see the
// useCallback'd handlers in ChatScreen).
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
  // Streaming deltas arrive from the streaming store, per id, so a delta wakes
  // this bubble and no other — the list stays stable per token and only the live
  // bubble's text changes.
  const streamDelta = useStreamingText(item.id);
  const mergedText = streamDelta ? item.text + streamDelta : item.text;
  // The streaming bubble advances on the reveal ticker — see useSmoothText().
  const liveText = useSmoothText(mergedText, item.pending);
  // `MEDIA:<path>` is the agent's attachment contract — assistant replies only
  // (a user quoting the tag shouldn't turn into an image).
  //
  // Lists are NOT flattened on the way in. They used to be, because a list item
  // drawn as a marker + text flex row measures as unbounded inside an auto-width
  // bubble and spilled out of it — but `li` is a plain block again, so that is a
  // property of a renderer this no longer has. Flattening cost every answer its
  // bullets and numbering, and collapsed a list into a run-on paragraph.
  const body = useMemo(() => (item.role === 'assistant' ? renderMediaTags(liveText) : liveText), [liveText, item.role]);
  // Only the tail of a streaming reply can still change, so the settled prefix is
  // memoised and the tail renders as plain text until it settles — see
  // splitSettled. That keeps the markdown re-parse per frame flat however long
  // the answer gets, without the old behaviour of showing the whole reply as raw
  // markdown and then reformatting all of it in one go when the turn ended.
  const streaming = item.role === 'assistant' && !!item.pending;
  const [settled, tail] = useMemo(() => (streaming ? splitSettled(body) : [body, '']), [body, streaming]);
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
  // Expand/collapse lives on the bubble surface for thinking + tool output: the
  // press must sit on an ANCESTOR of the text so taps anywhere (text included)
  // toggle. These two roles never render footer pressables, so there is no
  // nested-pressable conflict; other roles get an inert surface and keep their
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
  // Our own messages sit on the other side of the row from everything else. The
  // centring is a className rather than an `align` value because shadcn's
  // Message only has start/end — and `self-center` works here precisely because
  // MessageContent is a flex column, where the old transcript's `self-center`
  // silently did nothing (a plain block parent ignores align-self).
  const align = item.role === 'user' ? 'end' : 'start';
  return (
    <Message align={align}>
      <MessageContent>
        <Bubble
          ref={bubbleRef}
          variant={BUBBLE_VARIANT[item.role]}
          align={align}
          // 85% of the *content column*, not the window, so a long row (a thinking
          // summary, a tool card) can never spill past the column and drag a
          // horizontal scrollbar across the transcript.
          className={`max-w-[85%] ${item.role === 'notice' ? 'self-center' : ''}`}
          role={toggleable ? 'button' : undefined}
          aria-label={
            toggleable ? `${expanded ? 'Collapse' : 'Expand'} ${think ? 'thinking' : 'tool output'}` : undefined
          }
          aria-expanded={toggleable ? expanded : undefined}
          onClick={toggleable ? handleToggleClick : dismissKeyboard}
          {...(toggleable ? toggleLongPress : {})}>
          {/* The bubble's own radius, not shadcn's `rounded-xl`: the surface used
              to be 14px and the brief was to keep the transcript's look. */}
          <BubbleContent className="rounded-[14px]">
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
                      <div className="mt-1 text-[11px] italic text-neutral-400 dark:text-neutral-500">
                        no result captured
                      </div>
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
                // Long-press our own message for the Copy / Edit menu. The bubble
                // above already handles the click, so this wrapper only adds the
                // gesture.
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
                  {/* The settled prefix and the tail are two ChatMarkdowns
                      rather than one: the split is at a blank line, so each half
                      is already a complete markdown document and the pair renders
                      exactly as the whole would. The prefix is memoised on its
                      body (see ChatMarkdown), so only the block still being
                      written is re-parsed per frame. */}
                  {!!settled && <ChatMarkdown body={settled} theme="ai" dark={dark} />}
                  {!!tail && <ChatMarkdown body={tail} theme="ai" dark={dark} />}
                </>
              )
            ) : (
              // 24px, matching the markdown body: a notice or interim line sits
              // between replies, and a different leading there reads as a
              // different document.
              <div className="text-[15px] leading-[24px] text-neutral-950 dark:text-neutral-100">{mergedText}</div>
            )}
            {/* Footer: bot time lives in its ⋯ menu, ours in the long-press menu —
                copy icon stays on bot bubbles only. Still inside the surface, not
                in shadcn's MessageFooter, because the buttons have always sat on
                the bubble's own background. */}
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
                  // toggles the menu on click, so a tooltip peek would also open it.
                  // The a11y label carries the meaning.
                  //
                  // A real menu rather than the Radix popover this was: arrow-key
                  // roving, typeahead, and Escape / outside-press come from the
                  // primitive, and selecting a row closes it without a PopoverClose
                  // wrapper. Also `w-48`: the content defaults to
                  // `w-(--anchor-width)` — the width of its trigger — which for a
                  // 24px icon button clamps the menu to `min-w-32`.
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon" aria-label="More actions" className="h-6 w-6" />}>
                      <Ellipsis size={12} color={dark ? '#aaa' : '#999'} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="end" className="w-48">
                      {!!item.ts && (
                        // A label, not a row: this is not an action. It has to sit
                        // inside a group — Base UI's GroupLabel reads its context and
                        // throws without one ("MenuGroupContext is missing").
                        <DropdownMenuGroup>
                          <DropdownMenuLabel className="flex items-center gap-2.5 px-3 py-2 text-[13px] font-normal text-neutral-500 dark:text-neutral-400">
                            <Clock size={17} color={dark ? '#888' : '#999'} />
                            {formatBubbleTime(item.ts)}
                          </DropdownMenuLabel>
                        </DropdownMenuGroup>
                      )}
                      <DropdownMenuItem
                        data-testid="menu-branch"
                        onClick={onBranchChat}
                        className="w-full items-center justify-start gap-2.5 px-3 py-2.5">
                        <GitFork size={17} color={dark ? '#aaa' : '#999'} />
                        <span className="text-[15px]">Branch chat</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
});
