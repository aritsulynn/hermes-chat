import { cn } from '@/utils/cn';
import * as React from 'react';

type TextareaProps = Omit<React.ComponentProps<'textarea'>, 'rows'> & {
  /** react-native always rendered multiline; a <textarea> always is one. */
  multiline?: boolean;
  /** Sets the starting height. `undefined` lets the field grow with content. */
  numberOfLines?: number;
  /** Folded into the field's own className — there is no separate placeholder
   *  element to style on the web. */
  placeholderClassName?: string;
};

function Textarea({ className, multiline, numberOfLines = 2, placeholderClassName, ...props }: TextareaProps) {
  return (
    <textarea
      // `field-sizing: content` grows the box with its content up to a cap set
      // by `max-height` in className, so the composer does not need a
      // scrollHeight measurement on every keystroke.
      className={cn(
        'text-foreground border-input dark:bg-input/30 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive flex min-h-16 w-full resize-y rounded-md border bg-transparent px-3 py-2 text-base shadow-sm shadow-black/5 outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 field-sizing-content md:text-sm',
        placeholderClassName,
        className,
      )}
      rows={numberOfLines}
      {...props}
    />
  );
}

export { Textarea };
export type { TextareaProps };
