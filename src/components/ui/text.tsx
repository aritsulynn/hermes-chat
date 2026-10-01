import { cn } from '@/utils/cn';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

const textVariants = cva('select-text text-foreground text-base', {
  variants: {
    variant: {
      default: '',
      h1: 'scroll-m-20 text-balance text-center text-4xl font-extrabold tracking-tight',
      h2: 'scroll-m-20 first:mt-0 border-border border-b pb-2 text-3xl font-semibold tracking-tight',
      h3: 'scroll-m-20 text-2xl font-semibold tracking-tight',
      h4: 'scroll-m-20 text-xl font-semibold tracking-tight',
      p: 'mt-3 leading-7 sm:mt-6',
      blockquote: 'mt-4 border-l-2 pl-3 italic sm:mt-6 sm:pl-6',
      code: 'bg-muted relative rounded px-[0.3rem] py-[0.2rem] font-mono text-sm font-semibold',
      lead: 'text-muted-foreground text-xl',
      large: 'text-lg font-semibold',
      small: 'text-sm font-medium leading-none',
      muted: 'text-muted-foreground text-sm',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
});

type TextVariantProps = VariantProps<typeof textVariants>;
type TextVariant = NonNullable<TextVariantProps['variant']>;

/**
 * Each variant renders as the element it names, rather than a `<div>` with a
 * heading role bolted on. The native build could not do this — `react-native`
 * has one `<Text>` and no `<h1>` — so it leaned on `role`/`aria-level`. Real
 * elements are what screen readers, in-page find (Ctrl+F), and browser
 * translation actually use, and they cost nothing to get right here.
 */
const TAG: Partial<Record<TextVariant, React.ElementType>> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  p: 'p',
  blockquote: 'blockquote',
  code: 'code',
};

type TextProps = Omit<React.ComponentProps<'div'>, 'color'> &
  TextVariantProps & {
    asChild?: boolean;
    /**
     * react-native's line clamp, kept so the ~25 call sites that use it do not
     * have to change. RN truncates on one line without wrapping, so 1 maps to
     * `truncate` rather than `line-clamp-1` (which still wraps and then clamps).
     */
    numberOfLines?: number;
  };

/**
 * `TextClassContext` used to live here, carrying button/badge/alert text
 * classes down to nested children. It existed because react-native's `<Text>`
 * does not pass font styling to a sibling `<Text>`, so a Button had to push
 * `text-primary-foreground` into whatever icon or label sat inside it. CSS
 * inheritance already does that, so on web the container simply carries the
 * text classes and its children pick them up. Every `useContext` that existed
 * only to read it is gone.
 */
function Text({ className, asChild = false, variant = 'default', numberOfLines, ...props }: TextProps) {
  const Component = asChild ? Slot : (variant ? (TAG[variant] ?? 'div') : 'div');
  const clamp = numberOfLines === 1 ? 'truncate' : numberOfLines ? `line-clamp-${numberOfLines}` : undefined;
  return <Component className={cn(textVariants({ variant }), clamp, className)} {...props} />;
}

export { Text, textVariants };
export type { TextProps, TextVariant };
