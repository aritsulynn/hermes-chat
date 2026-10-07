// The chat transcript's scroller.
//
// The scroll physics are shadcn's MessageScroller — what used to be hand-rolled
// here now lives in that package, and components/ui/message-scroller.tsx lists
// which behaviours moved. What is left in this file is the app-facing shape
// around it: the composer clearance, the jump-to-newest button docked above the
// overlaid footer, the load-older trigger at the top, and the imperative
// `scrollToEnd` the chat screen calls when you send.
//
// Rows must be MessageScrollerItem (or any element carrying `data-message-id`)
// and must be DIRECT children of the content box. That is not a style choice:
// the prepend correction restores position by measuring the first visible row,
// and it skips any child without a message id. The old wrapper div with
// `display: contents` would also break it, because a `display: contents` box has
// no rect to measure.
import { forwardRef, useCallback, useEffect, useImperativeHandle, type ReactNode, type UIEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Button } from '../ui/button';
import { Spinner } from '../ui/bits';
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '../ui/message-scroller';

// px from the true end that still counts as "at the bottom". This is the band in
// which the scroller stays in follow mode and the jump button stays hidden, and
// it is the app's original AT_END_PX carried over: MessageScroller's own default
// is 8px, which would drop out of following the moment a single token nudged
// the content, and would show the button for a 40px scroll.
const AT_END_PX = 120;

export interface TranscriptHandle {
  /** Jump to the newest row and resume following it. */
  scrollToEnd: (opts?: { behavior?: ScrollBehavior }) => void;
  scrollToStart: (opts?: { behavior?: ScrollBehavior }) => void;
}

export interface TranscriptProps {
  children: ReactNode;
  /**
   * Room to leave under the last row, in px — the measured height of the
   * composer that overlays the bottom of the scroller.
   *
   * This is a real trailing element rather than the content box's
   * `padding-bottom`, and that is load-bearing. The scroller watches the content
   * with a ResizeObserver, which observes the CONTENT box; with
   * `box-sizing: border-box` and `height: max-content`, growing the bottom
   * padding shrinks the content box by exactly as much, so the observer never
   * fires. The scroll height grows behind its back and the transcript settles
   * one composer-height short of the bottom. A real child grows the content box,
   * so the follow keeps up and scrollToEnd lands where it should.
   */
  clearance?: number;
  /**
   * The message column's own layout class — the chat screen's
   * `mx-auto w-full max-w-3xl`. Applied to the content box and, separately, to
   * the jump button's rail, so the button lines up with the bubbles instead of
   * with the window edge.
   */
  columnClassName: string;
  /** Classes for the content box only, on top of `columnClassName`. */
  contentClassName?: string;
  /**
   * The reserved scrollbar lane, in px. The content column is centred inside it,
   * so the jump button's rail has to be inset by it too or the two are a lane
   * apart.
   */
  gutter?: number;
  /**
   * Fires when the "is there anything to scroll to" state changes. `end` is true
   * while the user is parked away from the tail, which is the condition the chat
   * screen gates head-trimming on.
   */
  onScrollableChange?: (s: { start: boolean; end: boolean }) => void;
  /** Fires when the viewport is within `startReachedThreshold` px of the top. */
  onStartReached?: () => void;
  startReachedThreshold?: number;
  /** True while an older-history page is in flight. Drawn as an overlay, NOT as
   *  a scroller item: an item at the top would be the prepend anchor the package
   *  measures against, and removing it as the page lands would defeat
   *  `preserveScrollOnPrepend` (the transcript would jump down on every load). */
  loadingOlder?: boolean;
  /** The jump button floats this far above the scroller's bottom edge. */
  jumpBottom?: number;
  /**
   * The viewport element, for callers that need to measure something off it —
   * the chat screen reads the reserved scrollbar gutter this way. MessageScroller
   * composes this with its own internal ref rather than replacing it.
   */
  scrollerRef?: (el: HTMLDivElement | null) => void;
}

// Renders nothing. It exists so the imperative handle can be built *inside* the
// provider, where useMessageScroller() is legal — the chat screen renders the
// provider, so the screen itself is above it and cannot call the hook.
const ScrollBridge = forwardRef<TranscriptHandle>(function ScrollBridge(_props, ref) {
  const { scrollToEnd, scrollToStart } = useMessageScroller();
  useImperativeHandle(ref, () => ({ scrollToEnd, scrollToStart }), [scrollToEnd, scrollToStart]);
  return null;
});

// Reports the scrollable state up to the chat screen. Same constraint as
// ScrollBridge. `stateStore` already dedupes by value, so this only re-renders
// the screen when the booleans actually flip.
function ScrollableReporter({ onChange }: { onChange?: (s: { start: boolean; end: boolean }) => void }) {
  const scrollable = useMessageScrollerScrollable();
  useEffect(() => {
    onChange?.(scrollable);
  }, [scrollable, onChange]);
  return null;
}

// Jump to the newest message — shown only while there is something below the
// fold, which `scrollable.end` already means (it is forced false while
// following, so the button cannot fight the tail).
function JumpButton({ bottom }: { bottom: number }) {
  const { end } = useMessageScrollerScrollable();
  const { scrollToEnd } = useMessageScroller();
  if (!end) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      data-testid="scroll-to-bottom"
      onClick={() => scrollToEnd({ behavior: 'smooth' })}
      // `pointer-events-auto` is load-bearing and is the counterpart to the
      // `pointer-events-none` on the rail below: that is inherited, so without
      // this the button paints but cannot be clicked. Same pairing as the
      // composer card against the chat screen's overlay footer.
      // `right-3` is inside the column the rail provides, so the button sits on
      // the bubbles' right edge rather than the window's.
      className="pointer-events-auto absolute right-3 z-40 h-9 w-9 items-center justify-center rounded-full border border-border bg-popover text-[#333] dark:bg-[#2a2a2a] dark:text-[#e5e5e5]"
      // Floats just above the footer, whose measured height already includes
      // the keyboard lift.
      style={{ bottom, boxShadow: '0 2px 6px rgb(0 0 0 / 0.18)' }}>
      <ChevronDown size={18} />
    </Button>
  );
}

export const Transcript = forwardRef<TranscriptHandle, TranscriptProps>(function Transcript(
  {
    children,
    columnClassName,
    contentClassName,
    clearance = 0,
    gutter = 0,
    onScrollableChange,
    onStartReached,
    startReachedThreshold = 200,
    loadingOlder = false,
    jumpBottom = 0,
    scrollerRef,
  },
  ref,
) {
  // Load-older has no equivalent in the package: its `scrollable.start` means
  // "there is content above", not "the top was reached", so the trigger is a
  // plain scroll-position test on the viewport's own event.
  const handleScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      if (onStartReached && e.currentTarget.scrollTop <= startReachedThreshold) onStartReached();
    },
    [onStartReached, startReachedThreshold],
  );

  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end" scrollEdgeThreshold={AT_END_PX}>
      <MessageScroller>
        <MessageScrollerViewport ref={scrollerRef} onScroll={handleScroll}>
          {/* The transcript's own row gap lives here, so the clearance below can
              cancel exactly one of them without having to know the caller's. */}
          <MessageScrollerContent className={cn('gap-2', columnClassName, contentClassName)}>
            {children}
            {/* The composer clearance — see the note on TranscriptProps.clearance.
                The negative top margin cancels the single row gap declared above,
                so the reserved room is exactly the measured composer height. */}
            {clearance > 0 && <div aria-hidden style={{ height: Math.round(clearance), marginTop: '-0.5rem' }} />}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* Older-history spinner. An overlay, not a content item: a leading item
            would be the prepend anchor the scroller measures, and removing it as
            the page lands breaks `preserveScrollOnPrepend`. `pointer-events-none`
            so it cannot swallow the scroll gesture that started under it. */}
        {loadingOlder && (
          <div
            data-slot="message-scroller-loading"
            className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center py-2">
            <Spinner size={14} color="currentColor" />
          </div>
        )}
        {/* The jump button rides a rail that mirrors the message column, not the
            window. Anchored to the window it sat a couple of hundred pixels out
            at desktop width, pointing at nothing in particular.
            The outer strip is inset by the scrollbar lane — the same lane the
            content column is centred inside — and the inner box is the column, so
            the button lands on the bubbles' own right edge at any width.
            The inner box is `relative` so the button's `right-*` is measured
            against the column rather than the strip.
            `pointer-events-none` here is inherited by everything inside, which is
            why the button has to opt back in. */}
        <div
          data-slot="message-scroller-jump"
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{ paddingRight: gutter }}>
          <div className={cn('relative mx-auto w-full', columnClassName)}>
            <JumpButton bottom={jumpBottom} />
          </div>
        </div>
        <ScrollableReporter onChange={onScrollableChange} />
        <ScrollBridge ref={ref} />
      </MessageScroller>
    </MessageScrollerProvider>
  );
});
