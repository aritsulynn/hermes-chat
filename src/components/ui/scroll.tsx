// ScrollArea — the ScrollView replacement, and the reason it exists as its own
// component rather than a className at each call site.
//
// ScrollView has two boxes: the scroller and a `contentContainer` inside it.
// That inner box is not decoration — layouts here rely on it, e.g. a list that
// is `flex-1` with `gap` between children, where the gap has to come from the
// container and not from the scroller. Collapsing them to one div breaks those.
//
// Deliberately not Radix's ScrollArea: that wraps content in a viewport div of
// its own, which costs the native scrollbar, trackpad momentum and
// `position: sticky` inside. A plain overflow container is both simpler and
// more native-feeling; the only thing given up is a styled scrollbar, which
// was never there on native either.
import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { ScrollArea } from '../../components/ui/scroll';

type ScrollAreaProps = {
  /** The scroller. */
  className?: string;
  /** The inner content box — the equivalent of `contentContainerStyle`. */
  contentClassName?: string;
  children?: ReactNode;
  /** Horizontal scroller, for the chip rows and tab strips. */
  horizontal?: boolean;
  /** Native scrollers do not show a bar on touch; the web shows a fat one. */
  hideScrollbar?: boolean;
};

export const ScrollArea = forwardRef<
  HTMLDivElement,
  ScrollAreaProps & Omit<ComponentPropsWithoutRef<'div'>, 'children'>
>(function ScrollArea(
  { className, contentClassName, children, horizontal, hideScrollbar, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(horizontal ? 'overflow-x-auto' : 'overflow-y-auto', hideScrollbar && 'scrollbar-none', className)}
      {...rest}>
      <div className={contentClassName}>{children}</div>
    </div>
  );
});

export { ScrollArea as default };
