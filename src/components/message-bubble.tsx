import type * as React from 'react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { Brain, Check, Cog, Copy, Ellipsis, FileText, RotateCcw } from 'lucide-react-native';
import { cleanThinking, flattenLists, renderMediaTags } from '../utils/messages';
import type { UiMessage } from '../utils/messages';
import { countDiffLineStats, diffLineKind, inlineDiffFromDetail, looksLikeDiff, stripInlineDiffChrome } from '../utils/diff';
import { TypingDots, Tap } from './bits';
import type { AnchorMeasure } from './composer';
import { mdAi, mdAiDark, mdUser, mdUserDark, makeSelectableRules } from './markdown';

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
// every bubble's <Markdown> re-parses, and react-native-markdown-display mints
// fresh random keys per parse — so the whole native text tree of every bubble
// was being torn down and rebuilt ~30×/s. That churn is what was yanking focus
// out of the composer mid-sentence. Props must stay referentially stable
// (see the useCallback'd handlers in ChatScreen).
const DIFF_MAX_LINES = 160;

// System monospace on some OEM Android builds (notably Xiaomi/HyperOS) ships
// without Thai glyphs and with broken fallback — Thai text set in `font-mono`
// renders as tofu squares. Detect Thai and fall back to the default UI font
// for those lines (ASCII diffs/tables keep their alignment everywhere else).
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

// Inline unified diff (one RN Text per line so +/- can be tinted; a single
// <Text> can't carry a per-line background). Rows are capped — a huge patch on a
// phone is unreadable anyway; the full diff is still on the tool result.
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
    kind === 'add' ? (dark ? 'rgba(95,210,138,0.12)' : '#e6ffec') : kind === 'del' ? (dark ? 'rgba(255,138,138,0.12)' : '#ffebe9') : undefined;
  return (
    <View className="mt-1 overflow-hidden rounded-lg border border-neutral-200/70 dark:border-neutral-700/70">
      {shown.map((line, i) => {
        const kind = diffLineKind(line);
        return (
          <View key={i} style={bgOf(kind) ? { backgroundColor: bgOf(kind) } : undefined}>
            <Text
              selectable
              className={hasThai(line) ? 'px-1.5 text-[11px] leading-[15px]' : 'px-1.5 font-mono text-[11px] leading-[15px]'}
              style={{ color: colorOf(kind) }}
            >
              {line || ' '}
            </Text>
          </View>
        );
      })}
      {lines.length > DIFF_MAX_LINES && (
        <Text className="px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
          … {lines.length - DIFF_MAX_LINES} more lines
        </Text>
      )}
    </View>
  );
});

// Plain monospace block for a tool RESULT (terminal output, file body, …).
// Capped: a giant dump on a phone is unreadable and expensive to lay out.
const OUTPUT_MAX_LINES = 200;

const ToolOutput = memo(function ToolOutput({ text }: { text: string }) {
  const lines = useMemo(() => text.split('\n'), [text]);
  const shown = lines.length > OUTPUT_MAX_LINES ? lines.slice(0, OUTPUT_MAX_LINES) : lines;
  return (
    <View className="mt-1 overflow-hidden rounded-lg border border-neutral-200/70 bg-black/[0.03] dark:border-neutral-700/70 dark:bg-white/[0.05]">
      {shown.map((l, i) => (
        <Text
          key={i}
          selectable
          className={
            hasThai(l)
              ? 'px-1.5 text-[11px] leading-[15px] text-neutral-700 dark:text-neutral-300'
              : 'px-1.5 font-mono text-[11px] leading-[15px] text-neutral-700 dark:text-neutral-300'
          }
        >
          {l || ' '}
        </Text>
      ))}
      {lines.length > OUTPUT_MAX_LINES && (
        <Text className="px-1.5 py-0.5 font-mono text-[10px] text-neutral-500 dark:text-neutral-400">
          … {lines.length - OUTPUT_MAX_LINES} more lines
        </Text>
      )}
    </View>
  );
});

// Stable thumbnail — inline `source={{uri}}` per render gives <Image> a new
// identity every token and forces a native re-resolve/flicker.
const BubbleThumb = memo(function BubbleThumb({ uri, name }: { uri: string; name: string }) {
  const source = useMemo(() => ({ uri }), [uri]);
  return <Image key={uri + name} source={source} resizeMode="cover" className="h-20 w-20 rounded-lg bg-black/10" />;
});

export const MessageBubble = memo(function MessageBubble({
  item,
  bubbleMax,
  dark,
  expanded,
  highlight,
  longFired,
  onToggleExpand,
  copied,
  onCopy,
  canRegenerate,
  canBranch,
  onRegenerate,
  onBranchMenu,
  onUserMenu,
  onTip,
}: {
  item: UiMessage;
  bubbleMax: number;
  dark: boolean;
  expanded: boolean;
  highlight?: boolean;
  longFired: React.MutableRefObject<boolean>;
  onToggleExpand: (id: string) => void;
  /** Boolean, not the copied id: an id prop would re-render every bubble. */
  copied: boolean;
  onCopy: (id: string, text: string) => void;
  /** Rerun the last turn — only on the last assistant bubble. */
  canRegenerate?: boolean;
  /** Per-message ⋯ menu (Branch chat) — assistant bubbles. */
  canBranch?: boolean;
  /** Screen-level popover trigger — same AnchorMeasure pattern as the composer. */
  onBranchMenu: (measure: AnchorMeasure, id: string) => void;
  /** Long-press menu for our own messages (Copy / Edit). */
  onUserMenu: (measure: AnchorMeasure, id: string) => void;
  /** Long-press tooltip for the footer icon buttons. */
  onTip: (measure: AnchorMeasure, label: string) => void;
  onRegenerate: () => void;
}) {
  const rules = useMemo(() => makeSelectableRules(dark), [dark]);
  // The streaming bubble changes on every token — see useThrottledText().
  const liveText = useThrottledText(item.text, item.pending);
  // `MEDIA:<path>` is the agent's attachment contract — assistant replies only
  // (a user quoting the tag shouldn't turn into an image).
  const body = useMemo(
    () => flattenLists(item.role === 'assistant' ? renderMediaTags(liveText) : liveText),
    [liveText, item.role],
  );
  const think = item.role === 'thinking';
  const typing = !think && item.pending && !item.text;
  const markdown =
    !think &&
    item.role !== 'notice' &&
    item.role !== 'interim' &&
    item.role !== 'tool' &&
    item.role !== 'summary';
  const copyable = (item.role === 'user' || item.role === 'assistant') && !!item.text && !item.pending;
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
  // Pressed highlight for the footer actions, tinted for the bubble they sit on.
  const actionPress =
    item.role === 'user' ? 'rgba(255,255,255,0.25)' : 'rgba(120,120,128,0.24)';
  // Anchor for the screen-level ⋯ popover (same measurer shape as Composer).
  const branchAnchorRef = useRef<View>(null);
  const copyAnchorRef = useRef<View>(null);
  const regenAnchorRef = useRef<View>(null);
  // Tooltip peek fired on a footer icon: swallow the onPress that fires on
  // release, so peeking at the label doesn't also trigger the action.
  const tipFired = useRef(false);
  const fireTip = (ref: { current: View | null }, label: string) => {
    tipFired.current = true;
    onTip((cb) =>
      ref.current?.measureInWindow((x, y, w, h) => {
        if (w > 0) cb({ x, y, w, h });
      }),
      label,
    );
  };
  const guardedPress = (fn: () => void) => () => {
    if (tipFired.current) {
      tipFired.current = false;
      return;
    }
    fn();
  };
  // Whole-bubble anchor for the long-press menu on our own messages.
  const bubbleRef = useRef<View>(null);
  return (
    <View
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
      }${highlight ? ' border-2 border-[#b45309] dark:border-[#fbbf24]' : ''}`}
      style={{ maxWidth: bubbleMax }}
    >
      {typing ? (
        <TypingDots />
      ) : think ? (
        item.text ? (
          <Tap
            onPress={() => {
              if (longFired.current) {
                longFired.current = false;
                return;
              }
              onToggleExpand(item.id);
            }}
            onLongPress={() => {
              longFired.current = true;
            }}
            radius={8}
          >
            <View className="flex-row gap-1.5">
              {/* Icon is 14px but a text line is 18px tall — center it inside a
                  line-height box so it lines up with the first line's glyphs
                  instead of riding the top of the line box. */}
              <View className="h-[18px] justify-center">
                <Brain size={14} color={dark ? '#999' : '#777'} />
              </View>
              <Text
                selectable={!!expanded}
                className="shrink text-[13px] leading-[18px] text-neutral-500 dark:text-neutral-400"
                numberOfLines={expanded ? undefined : 1}
              >
                {cleanThinking(item.text)}
              </Text>
            </View>
          </Tap>
        ) : (
          <TypingDots dim />
        )
      ) : item.role === 'tool' ? (
        <Tap
          onPress={() => {
            if (longFired.current) {
              longFired.current = false;
              return;
            }
            onToggleExpand(item.id);
          }}
          onLongPress={() => {
            longFired.current = true;
          }}
          radius={8}
        >
          <View className="flex-row gap-1.5">
            {/* Same line-height box as the thinking bubble: the 14px icon
                centers against the first 18px text line. */}
            <View className="h-[18px] justify-center">
              {item.pending ? (
                <Cog size={14} color={dark ? '#8fa8ff' : '#3b5bdb'} />
              ) : (
                <Check size={14} color={dark ? '#8fa8ff' : '#3b5bdb'} />
              )}
            </View>
            <Text
              selectable={!!expanded}
              className="shrink text-[13px] leading-[18px] text-[#3b5bdb] dark:text-[#8fa8ff]"
              numberOfLines={expanded ? undefined : 2}
            >
              {item.text}
            </Text>
            {!!toolDiff && (
              <Text className="shrink-0 text-[11px] font-semibold leading-[18px]">
                <Text className="text-[#1a7f37] dark:text-[#5fd28a]">＋{toolStats.added}</Text>
                <Text> </Text>
                <Text className="text-[#c5221f] dark:text-[#ff8a8a]">−{toolStats.removed}</Text>
              </Text>
            )}
          </View>
          {expanded && (
            <>
              {!!item.command && (
                <View className="mt-1 overflow-hidden rounded-lg border border-neutral-200/70 bg-neutral-100/60 dark:border-neutral-700/70 dark:bg-white/[0.05]">
                  <Text
                    selectable
                    className="px-1.5 py-1 font-mono text-[11px] leading-[15px] text-neutral-600 dark:text-neutral-300"
                  >
                    {item.command}
                  </Text>
                </View>
              )}
              {!!item.output && !(!!toolDiff && looksLikeDiff(item.output)) && <ToolOutput text={item.output} />}
              {!!toolDiff && <DiffView diff={toolDiff} dark={dark} />}
              {!item.output && !toolDiff && !item.command && !!item.detail && (
                <Text selectable className="mt-1 text-[12px] leading-[17px] text-neutral-600 dark:text-neutral-300">
                  {item.detail}
                </Text>
              )}
              {!item.output && !toolDiff && !item.command && !item.detail && !item.pending && (
                <Text className="mt-1 text-[11px] italic text-neutral-400 dark:text-neutral-500">
                  no result captured
                </Text>
              )}
            </>
          )}
        </Tap>
      ) : item.role === 'summary' ? (
        <View className="flex-row items-center gap-1.5">
          <FileText size={12} color={dark ? '#777' : '#999'} />
          <Text selectable className="text-[11px] text-neutral-500 dark:text-neutral-400">
            {item.text}
          </Text>
        </View>
      ) : markdown ? (
        item.role === 'user' ? (
          // Long-press our own message for the Copy / Edit menu. Plain
          // Pressable (no press tint) so the bubble look doesn't change.
          <Pressable
            onLongPress={() =>
              bubbleRef.current?.measureInWindow((x, y, w, h) => {
                if (w > 0) onUserMenu((cb) => cb({ x, y, w, h }), item.id);
              })
            }
            delayLongPress={400}
            accessibilityRole="button"
            accessibilityLabel="Message actions"
          >
            {!!item.media?.length && (
              <View className="mb-1 flex-row flex-wrap gap-1.5">
                {item.media.map((a) => (
                  <BubbleThumb key={a.uri + a.name} uri={a.uri} name={a.name} />
                ))}
              </View>
            )}
            {!!liveText && (
              <Markdown rules={rules} style={dark ? mdUserDark : mdUser}>{body}</Markdown>
            )}
          </Pressable>
        ) : (
          <>
            {!!item.media?.length && (
              <View className="mb-1 flex-row flex-wrap gap-1.5">
                {item.media.map((a) => (
                  <BubbleThumb key={a.uri + a.name} uri={a.uri} name={a.name} />
                ))}
              </View>
            )}
            {!!liveText && (
              <Markdown rules={rules} style={dark ? mdAiDark : mdAi}>{body}</Markdown>
            )}
          </>
        )
      ) : (
        <Text selectable className="text-[15px] leading-[21px] text-neutral-950 dark:text-neutral-100">
          {item.text}
        </Text>
      )}
      {/* Footer: bot time lives in its ⋯ menu, ours in the long-press menu —
          copy icon stays on bot bubbles only. */}
      {((copyable && item.role !== 'user') || canRegenerate || canBranch) && (
        <View className="mt-1 flex-row items-center gap-3 self-end">
          {copyable && item.role !== 'user' && (
            <Tap
              onPress={guardedPress(() => onCopy(item.id, item.text))}
              onLongPress={() => fireTip(copyAnchorRef, copied ? 'Copied!' : 'Copy')}
              delayLongPress={400}
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Copied' : 'Copy'}
              radius={6}
              highlight={actionPress}
              className="px-1.5 py-1"
              hitSlop={6}
            >
              <View ref={copyAnchorRef}>
                {copied ? (
                  <Check size={12} color={dark ? '#aaa' : '#999'} />
                ) : (
                  <Copy size={12} color={dark ? '#aaa' : '#999'} />
                )}
              </View>
            </Tap>
          )}
          {canRegenerate && (
            <Tap
              onPress={guardedPress(onRegenerate)}
              onLongPress={() => fireTip(regenAnchorRef, 'Regenerate')}
              delayLongPress={400}
              accessibilityRole="button"
              accessibilityLabel="Regenerate"
              radius={6}
              highlight={actionPress}
              className="px-1.5 py-1"
              hitSlop={6}
            >
              <View ref={regenAnchorRef}>
                <RotateCcw size={12} color={dark ? '#aaa' : '#999'} />
              </View>
            </Tap>
          )}
          {canBranch && (
            <Tap
              onPress={guardedPress(() =>
                onBranchMenu((cb) =>
                  branchAnchorRef.current?.measureInWindow((x, y, w, h) => {
                    if (w > 0) cb({ x, y, w, h });
                  }),
                  item.id,
                ),
              )}
              onLongPress={() => fireTip(branchAnchorRef, 'More actions')}
              delayLongPress={400}
              accessibilityRole="button"
              accessibilityLabel="More actions"
              radius={6}
              highlight={actionPress}
              className="px-1.5 py-1"
              hitSlop={6}
            >
              <View ref={branchAnchorRef}>
                <Ellipsis size={12} color={dark ? '#aaa' : '#999'} />
              </View>
            </Tap>
          )}
        </View>
      )}
    </View>
  );
});
