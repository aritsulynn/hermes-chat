import { cn } from '@/utils/cn';
import type { LucideIcon } from 'lucide-react';
import * as React from 'react';

function Alert({
  className,
  variant,
  children,
  icon: Icon,
  iconClassName,
  ...props
}: React.ComponentProps<'div'> & {
  icon: LucideIcon;
  variant?: 'default' | 'destructive';
  iconClassName?: string;
}) {
  return (
    <div
      role="alert"
      // `group` + `data-variant` is how AlertDescription picks its palette.
      data-variant={variant ?? 'default'}
      className={cn(
        'group bg-card border-border relative w-full rounded-lg border px-4 pb-2 pt-3.5 text-sm text-foreground',
        variant === 'destructive' && 'text-destructive',
        className,
      )}
      {...props}>
      <div className="absolute left-3.5 top-3">
        <Icon className={cn('size-4', variant === 'destructive' && 'text-destructive', iconClassName)} />
      </div>
      {children}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'h5'>) {
  return (
    <h5
      className={cn('mb-1 ml-0.5 min-h-4 pl-6 text-base font-medium leading-none tracking-tight', className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      className={cn(
        'text-muted-foreground group-data-[variant=destructive]:text-destructive/90 ml-0.5 pb-1.5 pl-6 text-sm leading-relaxed',
        className,
      )}
      {...props}
    />
  );
}

export { Alert, AlertDescription, AlertTitle };
