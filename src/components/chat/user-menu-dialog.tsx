// The long-press Copy/Edit menu on your own messages.
//
// A transparent Radix dialog: the library owns the full-bleed backdrop and
// stops clicks on the content reaching it, and the card is positioned from a
// measured anchor rect.
//
// The positioning is deliberately the same arithmetic as before, not Radix
// anchoring: the menu has to open *above* the message when there is room and
// flip below when the message is near the top of the viewport, and it has to
// stay inside the viewport on a narrow screen. Radix's collision detection
// would answer that, but it works off the trigger element, and here the
// trigger is a long-press with no persistent anchor node to measure.
import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';

export interface AnchorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MENU_W = 192;
const EDGE = 8;
/** Below this y the menu opens downward instead of upward. */
const FLIP_Y = 128;

export function UserMenuDialog({
  open,
  onOpenChange,
  anchor,
  viewportWidth,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchor?: AnchorRect;
  viewportWidth: number;
  children: ReactNode;
}) {
  // Clamp to the viewport so the card never hangs off the right edge.
  const left = anchor ? Math.max(EDGE, Math.min(anchor.x + anchor.w - MENU_W, viewportWidth - MENU_W - EDGE)) : EDGE;
  // Open upward when there is room above, downward otherwise.
  //
  // The `anchor` check has to come first and separately. This used to be
  // `!anchor || anchor.y > FLIP_Y`, which reads as "assume upward when we have
  // no anchor" and then dereferences `anchor.y` in that very branch — so the
  // no-anchor case was the one that threw. The `!` assertions hid it from the
  // typecheck, and it only surfaced on the first authenticated run of the app,
  // where the chat screen mounts this dialog before the first long-press has
  // ever produced a rect.
  const openUp = anchor ? anchor.y > FLIP_Y : false;
  const position = anchor
    ? openUp
      ? { bottom: Math.max(EDGE, window.innerHeight - anchor.y + 8) }
      : { top: anchor.y + anchor.h + 8 }
    : { top: EDGE };
  return (
    <DialogPrimitive.Root open={open && !!anchor} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* Transparent: the transcript behind stays readable. This is a
            context menu over the content, not a task dialog. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-50" />
        <DialogPrimitive.Content
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="bg-popover border-border fixed z-50 w-[192px] rounded-xl border p-1.5 shadow-lg outline-hidden"
          style={{ left, ...position }}>
          <DialogPrimitive.Title className="sr-only">Message actions</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
