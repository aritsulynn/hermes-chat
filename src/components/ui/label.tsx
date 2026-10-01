import { cn } from '@/utils/cn';
import * as React from 'react';

type LabelProps = React.ComponentProps<'label'>;

/**
 * A plain `<label>`. Clicking it focuses and toggles its associated control
 * natively, so no press handler is needed.
 */
function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        'text-foreground flex select-none items-center gap-2 text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-50 group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Label };
export type { LabelProps };
