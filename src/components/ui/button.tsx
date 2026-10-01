import { cn } from '@/utils/cn';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ComponentProps } from 'react';

const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive whitespace-nowrap outline-none transition-all focus-visible:ring-[3px] disabled:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 group inline-flex shrink-0 items-center justify-center gap-2 rounded-md shadow-none",
  {
    variants: {
      variant: {
        default: 'bg-primary shadow-sm shadow-black/5 hover:bg-primary/90',
        destructive:
          'bg-destructive shadow-sm shadow-black/5 hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40',
        outline:
          'border-border bg-background shadow-sm shadow-black/5 hover:bg-accent dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
        secondary: 'bg-secondary shadow-sm shadow-black/5 hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline group-hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3 sm:h-9',
        sm: 'h-9 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 sm:h-8',
        lg: 'h-11 rounded-md px-6 has-[>svg]:px-4 sm:h-10',
        icon: 'h-10 w-10 sm:h-9 sm:w-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

// On native this was a second cva handed to `TextClassContext`, because a
// `<button type="button">` cannot colour a nested `<Text>`. Here it merges straight into
// the button's own className and reaches the label and any icon by inheritance.
// `active:` becomes `active:` in CSS too, but a mouse-down on a real button
// does not reliably fire it, so the pressed state is carried by
// `active:opacity-*` in the base below rather than per-variant colour swaps.
const buttonTextVariants = cva('text-foreground pointer-events-none text-sm font-medium transition-colors', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      destructive: 'text-white',
      outline: 'group-active:text-accent-foreground group-hover:text-accent-foreground',
      secondary: 'text-secondary-foreground',
      ghost: 'group-active:text-accent-foreground',
      link: 'text-primary group-active:underline',
    },
    size: {
      default: '',
      sm: '',
      lg: '',
      icon: '',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;

/**
 * Forwards its ref to the underlying <button>. The composer and the chat
 * bubbles anchor popovers and long-press menus to specific controls, so what
 * they need to measure is the button itself, not an inner wrapper.
 */
const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        props.disabled && 'opacity-50',
        buttonVariants({ variant, size }),
        buttonTextVariants({ variant, size }),
        className,
      )}
      {...props}
    />
  );
});

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps };
