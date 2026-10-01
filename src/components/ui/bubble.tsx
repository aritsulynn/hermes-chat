// Bubble — the surface a message is drawn on.
//
// Vendored from shadcn's Base UI chat suite (style `base-nova`), which is why
// the palette variants below (`default` … `destructive`) are token-based. The
// `user` … `summary` variants are this app's own: the transcript's bubble colours
// are the ones the app already shipped with and the brief was to keep them
// exactly, so they are added as variants rather than mapped onto the palette.
//
// The user/assistant pair is the reason that mapping was not an option: `muted`
// and `secondary` are the same token, so both roles would come out the same
// colour, and in dark mode that is the *only* thing telling the two sides of the
// conversation apart.
//
// BubbleContent keeps Base UI's useRender (the same pattern as SidebarMenuButton)
// because that is what emits the `data-slot="bubble-content"` attribute every
// variant selector keys off. The variants set only the surface — background and
// border — because `BubbleContent`'s base already supplies the transparent
// border the colour then fills in.
import * as React from 'react';
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/utils/cn';

const bubbleVariants = cva(
  'group/bubble relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full',
  {
    variants: {
      variant: {
        // ── shadcn's palette, unused by the transcript but kept for new surfaces ──
        default:
          '*:data-[slot=bubble-content]:bg-primary *:data-[slot=bubble-content]:text-primary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-primary/80',
        secondary:
          '*:data-[slot=bubble-content]:bg-secondary *:data-[slot=bubble-content]:text-secondary-foreground [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]',
        muted:
          '*:data-[slot=bubble-content]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]',
        tinted:
          '*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.93_calc(c*0.4)_h)] *:data-[slot=bubble-content]:text-foreground dark:*:data-[slot=bubble-content]:bg-[oklch(from_var(--primary)_0.3_calc(c*0.4)_h)] [&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.88_calc(c*0.5)_h)] dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.35_calc(c*0.5)_h)]',
        outline:
          '*:data-[slot=bubble-content]:border-border *:data-[slot=bubble-content]:bg-background [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-input/30',
        ghost:
          'border-none *:data-[slot=bubble-content]:rounded-none *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted [&>[data-slot=bubble-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-muted/50',
        destructive:
          '*:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive dark:*:data-[slot=bubble-content]:bg-destructive/20 [&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=bubble-content]:is(button,a):hover]:bg-destructive/30',
        // ── this app's transcript roles ──
        // The hexes are the ones that were on the old bubble root, moved onto the
        // surface element the variant machinery styles. The `dark` spellings use
        // `dark:*:…` rather than `dark:[&>…]` to match how `tinted` above does it.
        user: '*:data-[slot=bubble-content]:bg-[#e5e7eb] dark:*:data-[slot=bubble-content]:bg-[#3f3f46]',
        assistant: '*:data-[slot=bubble-content]:bg-[#f0f0f2] dark:*:data-[slot=bubble-content]:bg-[#272727]',
        thinking:
          '*:data-[slot=bubble-content]:border-[#e2e2e6] *:data-[slot=bubble-content]:bg-[#f7f7f9] dark:*:data-[slot=bubble-content]:border-neutral-700 dark:*:data-[slot=bubble-content]:bg-[#212121]',
        interim:
          '*:data-[slot=bubble-content]:border-[#f0e0a0] *:data-[slot=bubble-content]:bg-[#fff8e1] dark:*:data-[slot=bubble-content]:border-[#6b5a1e] dark:*:data-[slot=bubble-content]:bg-[#3a2f10]',
        notice: '*:data-[slot=bubble-content]:bg-[#fdecea] dark:*:data-[slot=bubble-content]:bg-[#3d2020]',
        tool: '*:data-[slot=bubble-content]:border-[#d3e1f8] *:data-[slot=bubble-content]:bg-[#eef3fd] dark:*:data-[slot=bubble-content]:border-neutral-700 dark:*:data-[slot=bubble-content]:bg-[#272727]',
        summary: '*:data-[slot=bubble-content]:bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Bubble({
  variant = 'default',
  align = 'start',
  className,
  ...props
}: React.ComponentProps<'div'> &
  VariantProps<typeof bubbleVariants> & {
    align?: 'start' | 'end';
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({ className, render, ...props }: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'w-fit max-w-full min-w-0 overflow-hidden rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-hidden [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-ring/50',
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: 'bubble-content',
    },
  });
}

export { Bubble, BubbleContent, bubbleVariants };
