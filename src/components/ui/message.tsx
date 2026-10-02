// Message — the row shell around one entry in the transcript.
//
// Vendored from shadcn's Base UI chat suite (style `base-nova`). The suite ships
// MessageAvatar, MessageHeader, MessageGroup and MessageFooter as well; none of
// them are here because the transcript does not use them: there is one agent,
// rows carry no sender name, and the copy/regenerate/branch buttons live inside
// the bubble where they have always been rather than in a footer underneath it.
// Add them back with `npx shadcn@latest add message` if that changes.
//
// `align` is the whole job: `end` puts the user's own messages on the right, and
// the `data-align` it writes is what BubbleContent reads (through
// `group-data-[align=end]/message:*:data-slot:self-end`) to align the surface
// inside the content column. Alignment lives here rather than on the row's own
// `align-self` on purpose — the rows are full-width blocks, so an `align-self`
// on a child of the scroller would be inert, which is the exact trap the old
// transcript fell into with its `self-end`/`self-center` bubbles.
import * as React from 'react';
import { cn } from '@/utils/cn';

function Message({ className, align = 'start', ...props }: React.ComponentProps<'div'> & { align?: 'start' | 'end' }) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        'group/message relative flex w-full min-w-0 gap-2 text-sm data-[align=end]:flex-row-reverse',
        className,
      )}
      {...props}
    />
  );
}

function MessageContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        'flex w-full min-w-0 flex-col gap-2.5 wrap-break-word group-data-[align=end]/message:*:data-slot:self-end',
        className,
      )}
      {...props}
    />
  );
}

export { Message, MessageContent };
