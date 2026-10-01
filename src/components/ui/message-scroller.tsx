// MessageScroller — the transcript's scroll container.
//
// Unlike the rest of the chat suite, this is not vendored source: the behaviour
// lives inside shadcn's `@shadcn/react` package and this file is the styled
// wrapper around it, which is exactly what
// `npx shadcn@latest add message-scroller` writes. Only the parts the transcript
// uses are wrapped — MessageScrollerButton is left out because the chat screen
// docks its own jump button against the measured composer height, and the
// built-in one positions itself against the scroller's box instead.
//
// What the package now owns, all of which the transcript used to hand-roll over
// a known content height:
//
//   - following the tail while a turn streams (`autoScroll`, driven off the
//     content's ResizeObserver, so it is one scroll per frame at most)
//   - holding position when an older page is prepended
//     (`preserveScrollOnPrepend`, default on)
//   - landing at the end on first paint (`defaultScrollPosition`)
//   - reading a wheel / touch / key gesture as "the user is driving" and
//     dropping out of follow mode
//   - scrollToEnd / scrollToMessage / scrollToStart, plus the `scrollable`
//     state the jump button is gated on
//
// The registry's own viewport classes are not copied verbatim: it leans on a
// few utilities shadcn defines in its globals (`scroll-fade-b`, `scrollbar-thin`,
// `scrollbar-gutter-stable`) that this app has not got, and it sets
// `contain-content`, which would make the scroller a containing block for the
// composer overlay layered over it. The equivalents are spelled out instead.
import * as React from 'react';
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
} from '@shadcn/react/message-scroller';
import { cn } from '@/utils/cn';

function MessageScrollerProvider(props: React.ComponentProps<typeof MessageScrollerPrimitive.Provider>) {
  return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({ className, ...props }: React.ComponentProps<typeof MessageScrollerPrimitive.Root>) {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn('group/message-scroller relative flex min-h-0 flex-1 flex-col overflow-hidden', className)}
      {...props}
    />
  );
}

function MessageScrollerViewport({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        // `scrollbar-gutter: stable` reserves the scrollbar's lane permanently,
        // including for an overlay scrollbar that would otherwise draw on top of
        // the composer. The chat screen measures that lane to keep the composer
        // out of it.
        'size-full min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain [scrollbar-gutter:stable]',
        // Stay invisible until the opening scroll to the tail has run, so a cold
        // load cannot flash the top of the transcript first. The scroller raises
        // `data-pending-scroll` while the default position is still pending.
        'data-[pending-scroll]:invisible',
        className,
      )}
      {...props}
    />
  );
}

function MessageScrollerContent({
  className,
  ...props
}: React.ComponentProps<typeof MessageScrollerPrimitive.Content>) {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-6', className)}
      {...props}
    />
  );
}

function MessageScrollerItem({ className, ...props }: React.ComponentProps<typeof MessageScrollerPrimitive.Item>) {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      // The registry's `content-visibility: auto` + `contain-intrinsic-size`:
      // rows far outside the viewport are skipped, which is a real win on a
      // transcript of up to ~600 rows.
      //
      // This was removed once, because it looked like it broke the opening
      // scroll-to-end — the transcript settled part-way up the thread. That
      // turned out to be the composer clearance (a `padding-bottom` the
      // scroller's ResizeObserver cannot see), and with that fixed a fresh
      // transcript lands exactly on the bottom with this back on.
      //
      // The caveat that remains is inherent: a row that has never been rendered
      // reports its `contain-intrinsic-size` estimate rather than its real
      // height, so the scroll extent of a transcript nobody has scrolled
      // through yet is approximate and the scrollbar thumb is slightly off. The
      // browser's own scroll anchoring is what keeps that from reading as a jump.
      className={cn('min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]', className)}
      {...props}
    />
  );
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  useMessageScroller,
  useMessageScrollerScrollable,
};
