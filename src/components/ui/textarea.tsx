import { cn } from '@/utils/cn';
import { forwardRef, type ComponentProps } from 'react';

type TextareaProps = Omit<ComponentProps<'textarea'>, 'rows'> & {
  /** Accepted for compatibility; a <textarea> is always the multiline field. */
  multiline?: boolean;
  /** Sets the starting height. `undefined` lets the field grow with content. */
  numberOfLines?: number;
  /** Folded into the field's own className — there is no separate placeholder
   *  element to style on the web. */
  placeholderClassName?: string;
};

/** Forwards the ref so the composer can hold focus across a re-render. */
const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, multiline, numberOfLines = 2, placeholderClassName, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
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
});

export { Textarea };
export type { TextareaProps };
