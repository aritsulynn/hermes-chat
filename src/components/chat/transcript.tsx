// The chat transcript's scroller.
//
// This is not WindowedList, deliberately. The transcript is the one list in the
// app that FlashList was doing more than recycling for:
//
//   - It has to hold position when an older page is *prepended* above the
//     viewport, or the view yanks to the top mid-read. FlashList had
//     `maintainVisibleContentPosition` for that.
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
import { forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';

export interface TranscriptHandle {
  /** Absolute scroll, in px. */
  scrollToOffset: (opts: { offset: number; animated?: boolean }) => void;
  /** Scroll a row into view. `viewPosition` is 0..1 across the viewport. */
  scrollToIndex: (opts: { index: number; viewPosition?: number; animated?: boolean }) => Promise<void>;
  /** Current scroll offset, for the follow heuristic. */
  scrollTop: () => number;
  /** contentH - clientHeight, i.e. how far from the bottom we are. */
  distanceFromEnd: () => number;
}

export interface TranscriptProps {
  children: ReactNode;
  onScroll?: () => void;
  /** Fires when the scroller is within `threshold` px of the top. */
  onStartReached?: () => void;
  startReachedThreshold?: number;
  /** Fires when the content box changes size (rows added, keyboard resize). */
  onContentSizeChange?: (contentH: number) => void;
  className?: string;
  contentClassName?: string;
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(function Transcript(
  { children, onScroll, onStartReached, startReachedThreshold = 200, onContentSizeChange, className, contentClassName },
  ref,
) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
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
        // caller's own paging loop handles that, so fail the promise the way
        // the FlashList version caught.
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
    }),
    [],
  );

  return (
    <div
      ref={scroller}
      className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${className ?? ''}`}
      onScroll={() => {
        onScroll?.();
        const el = scroller.current;
        if (el && onStartReached && el.scrollTop <= startReachedThreshold) onStartReached();
      }}>
      <div
        className={contentClassName}
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
        {children}
      </div>
    </div>
  );
});
