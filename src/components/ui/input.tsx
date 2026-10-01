import { cn } from '@/utils/cn';
import * as React from 'react';

type InputProps = Omit<React.ComponentProps<'input'>, 'size'> & {
  /** Read-only switch; ignored because `disabled` already exists on <input>. */
  editable?: boolean;
};

function Input({ className, editable, ...props }: InputProps) {
  return (
    <input
      className={cn(
        'border-input bg-background text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 flex h-10 w-full min-w-0 rounded-md border px-3 py-1 text-base leading-5 shadow-sm shadow-black/5 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      disabled={editable === false || props.disabled}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
