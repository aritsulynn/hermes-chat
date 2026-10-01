import { cn } from '@/utils/cn';
import type { ComponentProps } from 'react';

// Placeholder block for the sidebar's menu skeleton. Nothing here is Base UI —
// it is a div with a pulse — but it ships alongside the sidebar and the sidebar
// imports it, so it lives here rather than being inlined.
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="skeleton" className={cn('bg-muted animate-pulse rounded-md', className)} {...props} />;
}

export { Skeleton };
