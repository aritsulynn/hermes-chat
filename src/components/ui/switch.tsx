import { cn } from '@/utils/cn';
import * as SwitchPrimitives from '@radix-ui/react-switch';
import * as React from 'react';

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitives.Root>) {
  return (
    <SwitchPrimitives.Root
      className={cn(
        'focus-visible:border-ring focus-visible:ring-ring/50 peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-sm shadow-black/5 outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
        props.checked ? 'bg-primary' : 'bg-input dark:bg-input/80',
        className,
      )}
      {...props}>
      <SwitchPrimitives.Thumb
        className={cn(
          'bg-background pointer-events-none block size-4 rounded-full ring-0 transition-transform',
          props.checked ? 'translate-x-3.5 dark:bg-primary-foreground' : 'translate-x-0 dark:bg-foreground',
        )}
      />
    </SwitchPrimitives.Root>
  );
}

export { Switch };
