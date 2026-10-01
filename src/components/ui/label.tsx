import { cn } from '@/utils/cn';
import * as React from 'react';

type LabelProps = React.ComponentProps<'label'>;

/**
 * A plain `<label>`.
 *
 * The native version was a pressable Root wrapping a Text, because
 * react-native has no `<label>`. That split existed only to forward
 * `onPress`/`onPressIn`/`onLongPress` to a touchable wrapper; no call site
 * passed any of them, and on the web clicking a `<label>` focuses and toggles
 * its associated control natively, which is strictly better than a synthetic
 * press handler.
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
