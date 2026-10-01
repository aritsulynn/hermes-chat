// WindowedList — the FlashList replacement.
//
// FlashList recycled native cells. The web has no equivalent: DOM nodes are the
// cost, and the way to bound them is to not mount the ones you cannot see.
//
// So this renders a trailing window of `initialPage` items and grows it as the
// scroller approaches the end, which doubles as the infinite-scroll hook
// (`onEndReached`). The lists this replaced — files, cron jobs, run history,
// log lines — are all server-paginated and bounded, so a growing window is
// enough. The chat transcript is the one screen that needs more than that
// (snap-to-bottom and scroll-position preservation when older history is
// prepended) and it does not use this component.
//
// The props deliberately keep FlashList's shape, including the
// `renderItem({ item, index })` signature and the `List*Component` props taking
// a component rather than a node. Every call site was already written against
// that, and re-shaping them would be churn for nothing.
//
// Not `@tanstack/react-virtual`: it measures rows to compute exact offsets,
// which is the right trade when rows have wildly different heights. These rows
// are near-uniform, and re-measuring them on every data change would cost more
// than the window saves.
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { Spinner } from './bits';

/** The imperative surface a list needs for its scroll-to-top/bottom controls. */
export interface WindowedListRef {
  scrollToEnd: (opts?: { animated?: boolean }) => void;
  scrollToIndex: (index: number, opts?: { animated?: boolean }) => void;
  scrollToTop: (opts?: { animated?: boolean }) => void;
}

export interface WindowedListProps<T> {
  data: T[];
  keyExtractor: (item: T, index: number) => string;
  renderItem: (info: { item: T; index: number }) => ReactNode;
  ListHeaderComponent?: ReactNode | ComponentType;
  ListEmptyComponent?: ReactNode | ComponentType;
  ItemSeparatorComponent?: ReactNode | ComponentType;
  /** Grows the window and fires when the scroller nears the end. */
  onEndReached?: () => void;
  loadingMore?: boolean;
  initialPage?: number;
  className?: string;
  contentClassName?: string;
  /** Distance from the end, in px, at which `onEndReached` fires. */
  endThreshold?: number;
}

/** FlashList's `List*Component` props took a component; accept either form. */
function renderMaybe(value: ReactNode | ComponentType | undefined, key: string) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'function') {
    const C = value as ComponentType;
    return <C key={key} />;
  }
  return <div key={key}>{value as ReactNode}</div>;
}

export function WindowedList<T>({
  data,
  keyExtractor,
  renderItem,
  ListHeaderComponent,
  ListEmptyComponent,
  ItemSeparatorComponent,
  onEndReached,
  loadingMore,
  initialPage = 60,
  className,
  contentClassName,
  endThreshold = 400,
  ref,
}: WindowedListProps<T> & { ref?: React.Ref<WindowedListRef> }) {
  const [count, setCount] = useState(initialPage);
  const scroller = useRef<HTMLDivElement | null>(null);
  // The dataset identity, so a new directory or a new search resets the window
  // without resetting on every array identity change (which is every poll).
  const dataset = data;
  const lastReset = useRef(dataset);

  if (lastReset.current !== dataset) {
    // Only reset when the *contents* changed, not the array identity: a 4s poll
    // that returns the same rows must not collapse the window back to 60.
    const sameIds =
      dataset.length === lastReset.current.length &&
      dataset.every((it, i) => keyExtractor(it, i) === keyExtractor(lastReset.current[i], i));
    if (!sameIds) {
      lastReset.current = dataset;
      setCount(initialPage);
      if (scroller.current) scroller.current.scrollTop = 0;
    }
  }

  // A shrinking list must not leave the window larger than the data.
  const windowed = useMemo(
    () => data.slice(Math.max(0, data.length - count)),
    [data, count],
  );
  const offset = data.length - windowed.length;

  // The scroll-to-top/bottom buttons outside the list drive it through this.
  // Rows are near-uniform but not identical (a wrapped log line is two), so
  // scrollToIndex is approximate: it clamps to the scroller rather than
  // measuring, which is all these buttons need.
  useImperativeHandle(
    ref,
    () => ({
      scrollToEnd: ({ animated = true } = {}) => {
        const el = scroller.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: animated ? 'smooth' : 'auto' });
      },
      scrollToIndex: (index: number, { animated = true } = {}) => {
        const el = scroller.current;
        if (!el) return;
        const top = Math.max(0, Math.min(index, data.length) * 48);
        el.scrollTo({ top, behavior: animated ? 'smooth' : 'auto' });
      },
      scrollToTop: ({ animated = true } = {}) => {
        scroller.current?.scrollTo({ top: 0, behavior: animated ? 'smooth' : 'auto' });
      },
    }),
    [data.length],
  );

  const handleScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    if (count < data.length) {
      setCount((c) => Math.min(c + initialPage, data.length));
      return;
    }
    if (loadingMore || !onEndReached) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= endThreshold) onEndReached();
  }, [count, data.length, endThreshold, initialPage, loadingMore, onEndReached]);

  return (
    <div
      ref={scroller}
      onScroll={handleScroll}
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain', className)}>
      <div className={cn('flex min-h-full flex-col', contentClassName)}>
        {renderMaybe(ListHeaderComponent, 'header')}
        {data.length === 0
          ? renderMaybe(ListEmptyComponent, 'empty')
          : windowed.map((item, i) => (
              <div key={keyExtractor(item, offset + i)}>
                {i > 0 && renderMaybe(ItemSeparatorComponent, `sep-${i}`)}
                {renderItem({ item, index: offset + i })}
              </div>
            ))}
        {loadingMore && (
          <div className="flex items-center justify-center gap-2 py-3">
            <Spinner size={14} color="currentColor" />
          </div>
        )}
      </div>
    </div>
  );
}
