// The chat transcript's scroller.
//
// A hand-rolled scroller rather than a generic list, because the transcript is
// the one list in the app that needs more than rendering rows:
//
//   - It has to hold position when an older page is *prepended* above the
//     viewport, or the view yanks to the top mid-read.
//   - It has to keep following the tail while tokens stream in, but stop the
//     moment the user scrolls up.
//   - It is driven from outside by absolute offsets (the measured end, the
//     prepend correction) and by row index (a search hit).
//
// All three are scroll-position arithmetic over a known content height, which
// is a plain scroll container plus a small imperative handle. A virtualizer
// would have to be told all of it as well, and would then re-estimate row
// heights it has no business guessing on a transcript of variable-height
// markdown.
//
// The list is bounded by the store, not here: CHAT_WINDOW_TRIM_KEEP trims the
// transcript to ~600 rows, so every row is mounted and that is the intended
// cost, not an oversight.
import { forwardRef, useImperativeHandle, useRef, type CSSProperties, type ReactNode } from 'react';

export interface TranscriptHandle {
  /** Absolute scroll, in px. */
  scrollToOffset: (opts: { offset: number; animated?: boolean }) => void;
  /** Scroll a row into view. `viewPosition` is 0..1 across the viewport. */
  scrollToIndex: (opts: { index: number; viewPosition?: number; animated?: boolean }) => Promise<void>;
  /** Current scroll offset, for the follow heuristic. */
  scrollTop: () => number;
  /** contentH - clientHeight, i.e. how far from the bottom we are. */
  distanceFromEnd: () => number;
  /** The scroller's client height, for callers that need the other half. */
  viewportHeight: () => number;
}

export interface TranscriptProps {
  children: ReactNode;
  onScroll?: () => void;
  /** Fires when the scroller is within `threshold` px of the top. */
  onStartReached?: () => void;
  startReachedThreshold?: number;
  /** Fires when the content box changes size (rows added, keyboard resize). */
  onContentSizeChange?: (contentH: number) => void;
  /**
   * Fires when the *scroller* changes height — the keyboard opening, a rotation,
   * the composer growing.
   *
   * This is not the same number as onContentSizeChange and the distinction is
   * load-bearing: the distance to the end of the list is `content - viewport`,
   * so a screen deciding whether the user is "at the bottom" needs the viewport
   * height, not the content height. Reporting only one of the two is how a
   * transcript ends up unable to work out that it is at the bottom, and
   * therefore never follows the tail.
   */
  onViewportResize?: (viewportH: number) => void;
  /**
   * Pointer down / pointer up on the scroller — the DOM spellings of
   * onScrollBeginDrag / onScrollEndDrag.
   *
   * There is no "the user stopped scrolling" event that fires on a release
   * rather than on a scroll tick, so a screen that wants to act on the release
   * (a snap-through, a settle-the-follow-state) needs to be told the edges
   * directly. `onInteractEnd` also covers a trackpad fling that has already
   * come to rest before the last scroll event was delivered.
   *
   * A wheel or trackpad gesture fires neither pointerdown nor pointerup, so
   * `onInteractStart` is also raised for those and held open until the gesture
   * goes quiet. Without it, "the user is driving" was only ever true for a
   * mouse drag, and on a desktop every wheel scroll looked like a stray layout
   * shift to the chat screen — which is what made wheel-up get dragged back to
   * the bottom while dragging the scrollbar worked.
   */
  onInteractStart?: () => void;
  onInteractEnd?: () => void;
  /** Idle ms after the last wheel event before the gesture counts as over. */
  wheelIdleMs?: number;
  className?: string;
  contentClassName?: string;
  /**
   * Inline style for the content box, for values Tailwind cannot know at
   * build time. The composer clearance is one: it is the measured footer
   * height, so it has to be a style and not a class — a class built from a
   * template literal is invisible to the scanner and is simply never
   * emitted, which is how the transcript ended up with `pb-[0px]` and no
   * bottom padding at all.
   */
  contentStyle?: CSSProperties;
  /**
   * The scroller element, for callers that need to measure something off it —
   * the chat screen reads the reserved scrollbar gutter this way, and its ref is
   * a callback so it survives the scroller being in a conditional branch.
   */
  scrollerRef?: (el: HTMLElement | null) => void;
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(function Transcript(
  {
    children,
    onScroll,
    onStartReached,
    startReachedThreshold = 200,
    onContentSizeChange,
    onViewportResize,
    onInteractStart,
    onInteractEnd,
    wheelIdleMs = 160,
    className,
    contentClassName,
    contentStyle,
    scrollerRef,
  },
  ref,
) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  // Debounce handle for the wheel gesture. Kept here rather than in the screen
  // so the idle window is a property of the gesture, not of the caller.
  const wheelIdle = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Row offsets, refreshed whenever the content resizes. `scrollToIndex` needs
  // them and a DOM query per row is not an option on a 600-row transcript.
  const rowTops = useRef<number[]>([]);

  const measureRows = () => {
    const host = inner.current;
    if (!host) return;
    const kids = host.children;
    const tops: number[] = new Array(kids.length);
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i] as HTMLElement;
      tops[i] = el.offsetTop - (host.offsetTop || 0);
    }
    rowTops.current = tops;
  };

  useImperativeHandle(
    ref,
    () => ({
      scrollToOffset: ({ offset, animated = true }) => {
        const el = scroller.current;
        if (!el) return;
        el.scrollTo({ top: Math.max(0, offset), behavior: animated ? 'smooth' : 'auto' });
      },
      scrollToIndex: async ({ index, viewPosition = 0, animated = true }) => {
        const el = scroller.current;
        if (!el) return;
        if (!rowTops.current.length) measureRows();
        const top = rowTops.current[index];
        // An index past the measured set means the row is not mounted yet; the
        // caller's own paging loop handles that, so the promise rejects.
        if (top === undefined) throw new Error('row not measured');
        const target = top - el.clientHeight * viewPosition;
        el.scrollTo({ top: Math.max(0, target), behavior: animated ? 'smooth' : 'auto' });
        // A smooth scroll is still in flight when this resolves; the caller only
        // awaits to sequence the next step, so report completion immediately.
      },
      scrollTop: () => scroller.current?.scrollTop ?? 0,
      distanceFromEnd: () => {
        const el = scroller.current;
        if (!el) return 0;
        return el.scrollHeight - el.scrollTop - el.clientHeight;
      },
      viewportHeight: () => scroller.current?.clientHeight ?? 0,
    }),
    [],
  );

  return (
    <div
      // A callback ref rather than `ref={scroller}`, because observing the
      // scroller's own box needs the element, and there is no hook equivalent
      // that fires on a height change.
      ref={(el) => {
        scroller.current = el;
        scrollerRef?.(el);
        if (!el) return;
        // This is the scroller's box, as opposed to the content box observed
        // below. Watching only the content would never report a height change,
        // because a keyboard resize shrinks the scroller while the content
        // stays exactly where it was.
        const ro = new ResizeObserver(() => onViewportResize?.(el.clientHeight));
        ro.observe(el);
        onViewportResize?.(el.clientHeight);
        return () => ro.disconnect();
      }}
      // `scrollbar-gutter: stable` reserves the scrollbar's width permanently,
      // including for an overlay scrollbar that otherwise draws on top of
      // whatever is layered over the list. The chat composer sits over the
      // right edge of this scroller, so without a reserved gutter the composer
      // painted over the scroll control: the scrollbar was still there and
      // still draggable, just invisible.
      className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable] ${className ?? ''}`}
      onPointerDown={() => onInteractStart?.()}
      // pointercancel is not optional here: a drag that leaves the window, or a
      // scrollbar grab the browser takes over, never delivers pointerup — and
      // leaving `touching` set would wedge the follow heuristic.
      onPointerUp={() => onInteractEnd?.()}
      onPointerCancel={() => onInteractEnd?.()}
      // A wheel or trackpad gesture has no pointer events at all, so it is
      // opened on the first event and closed once `wheelIdleMs` passes with
      // nothing. `deltaY` is only read to keep the handler honest about being a
      // wheel listener; the direction is the screen's business, not this one's.
      onWheel={() => {
        onInteractStart?.();
        if (wheelIdle.current) clearTimeout(wheelIdle.current);
        wheelIdle.current = setTimeout(() => {
          wheelIdle.current = null;
          onInteractEnd?.();
        }, wheelIdleMs);
      }}
      onScroll={() => {
        onScroll?.();
        const el = scroller.current;
        if (el && onStartReached && el.scrollTop <= startReachedThreshold) onStartReached();
      }}>
      <div
        className={contentClassName}
        style={contentStyle}
        onLoad={measureRows}
        // A ResizeObserver rather than a layout callback: rows change height
        // without the content box's own ref firing (a wrapped markdown block, an
        // image decoding, the composer resizing), and every one of those has to
        // update the row offsets the search-jump path depends on.
        ref={(el) => {
          inner.current = el;
          if (!el) return;
          measureRows();
          const ro = new ResizeObserver(() => {
            measureRows();
            onContentSizeChange?.(el.scrollHeight);
          });
          ro.observe(el);
          return () => ro.disconnect();
        }}>
        {/*
         The rows are wrapped in a div so each can carry a key, and that wrapper
         is given `display: contents` so it does not become the flex item. This
         is load-bearing: the content box is a flex column, and MessageBubble
         positions itself with `self-end` (the user's own messages) and
         `self-center` (notices). With a real wrapper in between, the wrapper
         stretched to the full width and the bubble's align-self had no effect —
         every bubble came out full-width and left-aligned, instead of the
         user's sitting on the right. `display: contents` removes the wrapper
         from layout so the bubble is the direct flex item. It is safe here
         because the wrapper carries no semantics of its own.
        */}
        {children}
      </div>
    </div>
  );
});
