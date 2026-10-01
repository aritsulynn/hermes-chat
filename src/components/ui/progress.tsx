import { cn } from '@/utils/cn';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as React from 'react';

function Progress({
  className,
  value,
  indicatorClassName,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value ?? 0));
  return (
    <ProgressPrimitive.Root
      className={cn('bg-primary/20 relative h-2 w-full overflow-hidden rounded-full', className)}
      value={clamped}
      {...props}>
      {/* Full-width bar slid out of view, rather than a bar whose width is a
          percentage — the slide transitions on a compositor thread, so a
          progress value ticking every few hundred ms does not relayout the
          whole page the way animating `width` would. The native build animated
          width with a spring; this is the web equivalent of the same effect. */}
      <ProgressPrimitive.Indicator
        className={cn('bg-primary h-full w-full flex-1 transition-transform duration-300', indicatorClassName)}
        style={{ transform: `translateX(-${100 - clamped}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
