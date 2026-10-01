// Edge-swipe open/close for the mobile nav drawer.
//
// A browser page cannot claim the system edge gesture, and the drawer's own
// primitive (Base UI Dialog) only knows buttons and overlay taps — so like
// OpenChamber, this is a small hand-rolled touch detector, not a library
// feature: it only decides "was that a horizontal swipe from an edge toward
// the centre" and fires a callback. The drawer's own transition plays itself.
//
// Two modes. Drawer closed: only a swipe that *starts* within the edge zone
// (32px, 80px on Android where the system Back gesture owns the rim) counts,
// so normal list scrolling never opens anything. Drawer open: the swipe may
// start anywhere — a leftward drag out of the panel is the close — because the
// panel already owns the screen and there is nothing underneath to steal.
//
// Guards: multi-touch is ignored, a text selection cancels the swipe, a swipe
// that starts inside a horizontally-scrolling strip (breadcrumbs, chip rows)
// belongs to that scroller, and the open-swipe is suppressed while some other
// dialog/sheet is up (opening the nav under a bottom sheet helps nobody).
// All listeners are passive, so scrolling and selection stay native.
import { useEffect, useRef } from 'react';

const EDGE_ZONE = 32;
const ANDROID_EDGE_ZONE = 80;
const MIN_DISTANCE = 64;
// |dy| must stay below |dx| * this — keeps it a horizontal swipe, so vertical
// list scrolling can never trigger it.
const MAX_OFF_AXIS_RATIO = 0.7;

export interface EdgeSwipeOptions {
  /** Swipe that started at the left edge and travelled right. */
  onLeftEdgeSwipe?: () => void;
  /** Swipe that started at the right edge and travelled left. */
  onRightEdgeSwipe?: () => void;
  /** When true (drawer open), the swipe may start anywhere, not just an edge. */
  anywhere?: boolean;
  /** Listener master switch — off on desktop, where there is no overlay drawer. */
  enabled?: boolean;
}

// The widened zone is about the *browser* gesture environment, not the shell:
// Android reserves the rim for system Back in Chrome too, so this is a UA
// check rather than a Capacitor platform check.
function isAndroid(): boolean {
  return /android/i.test(globalThis.navigator?.userAgent ?? '');
}

function startedInHorizontalScroller(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  let el: Element | null = target;
  while (el) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 4) return true;
    el = el.parentElement;
  }
  return false;
}

function anotherDialogIsUp(): boolean {
  // The nav drawer itself is a dialog when open — callers only ask this while
  // it is closed, so any dialog found here belongs to someone else.
  return globalThis.document?.querySelector('[role="dialog"]') != null;
}

export function useEdgeSwipe({ onLeftEdgeSwipe, onRightEdgeSwipe, anywhere, enabled = true }: EdgeSwipeOptions): void {
  // Callbacks in a ref so changing identities never re-attach the listeners.
  const handlers = useRef({ onLeftEdgeSwipe, onRightEdgeSwipe });
  handlers.current = { onLeftEdgeSwipe, onRightEdgeSwipe };

  useEffect(() => {
    if (!enabled) return;
    const doc = globalThis.document;
    if (!doc) return;
    const edgeZone = isAndroid() ? ANDROID_EDGE_ZONE : EDGE_ZONE;

    let tracking = false;
    let fromLeftEdge = false;
    let startX = 0;
    let startY = 0;

    const hasSelection = () => doc.getSelection()?.isCollapsed === false;
    const cancel = () => {
      tracking = false;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || hasSelection()) {
        tracking = false;
        return;
      }
      const touch = event.touches[0];
      if (!anywhere) {
        const width = globalThis.innerWidth || 0;
        const nearLeft = touch.clientX <= edgeZone;
        const nearRight = touch.clientX >= width - edgeZone;
        if (!nearLeft && !nearRight) {
          tracking = false;
          return;
        }
        fromLeftEdge = nearLeft;
      } else {
        // Close direction is always leftward; the start side is irrelevant.
        fromLeftEdge = false;
      }
      if (startedInHorizontalScroller(event.target)) {
        tracking = false;
        return;
      }
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      if (hasSelection()) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < MIN_DISTANCE) return;
      if (Math.abs(dy) > Math.abs(dx) * MAX_OFF_AXIS_RATIO) return;
      // Must travel toward the centre; a swipe back where it came from is a
      // scroll that changed its mind, not a drawer gesture.
      if (fromLeftEdge && dx <= 0) return;
      if (!fromLeftEdge && dx >= 0) return;
      if (fromLeftEdge) {
        if (anotherDialogIsUp()) return;
        handlers.current.onLeftEdgeSwipe?.();
      } else {
        handlers.current.onRightEdgeSwipe?.();
      }
    };

    doc.addEventListener('touchstart', onTouchStart, { passive: true });
    doc.addEventListener('touchend', onTouchEnd, { passive: true });
    doc.addEventListener('touchcancel', cancel, { passive: true });
    doc.addEventListener('selectionchange', cancel);
    return () => {
      doc.removeEventListener('touchstart', onTouchStart);
      doc.removeEventListener('touchend', onTouchEnd);
      doc.removeEventListener('touchcancel', cancel);
      doc.removeEventListener('selectionchange', cancel);
    };
  }, [enabled, anywhere]);
}
