// Viewport size, tracked live.
//
// Not a constant read at mount: the chat screen's bubble width is a percentage
// of the window and its composer listens to the visual viewport, so both have
// to react to a resize, a rotation, or a mobile browser's address bar
// collapsing.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

export interface ViewportSize {
  width: number;
  height: number;
  /** How much of the layout viewport the virtual keyboard is covering. */
  keyboard: number;
}

function read(): ViewportSize {
  const width = globalThis.innerWidth || 1024;
  const height = globalThis.innerHeight || 768;
  const vv = globalThis.visualViewport;
  const keyboard = vv ? Math.max(0, Math.round(window.innerHeight - vv.height - (vv.offsetTop ?? 0))) : 0;
  return { width, height, keyboard };
}

export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    globalThis.addEventListener('resize', onResize);
    // The visual viewport is the only thing that reports the keyboard, and it
    // fires its own resize without a window resize on mobile.
    globalThis.visualViewport?.addEventListener('resize', onResize);
    return () => {
      globalThis.removeEventListener('resize', onResize);
      globalThis.visualViewport?.removeEventListener('resize', onResize);
    };
  }, []);
  return size;
}

/**
 * Does the viewport match a media query, tracked live.
 *
 * Separate from `useViewportSize` on purpose. That one re-renders on every
 * pixel of a resize, which is right for a bubble width that is a percentage of
 * the window but wrong for a layout that changes at a breakpoint: a sidebar
 * only cares about which side of 768px it is on, and re-rendering the whole
 * shell — and the screen inside it — on every drag of a window edge is work
 * with nothing to show for it. `matchMedia` fires once per crossing.
 *
 * The value is read during render, not in an effect, so the first paint already
 * has the right answer and the layout never flashes the wrong mode.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = globalThis.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => globalThis.matchMedia(query).matches,
    // No SSR in this build; the third argument only has to exist.
    () => false,
  );
}

/**
 * The sidebar's breakpoint, as a boolean: is the viewport phone-shaped?
 *
 * The sidebar renders two different *things* either side of this line — an
 * in-flow panel above it and a modal sheet below it, not two styles of the same
 * panel. So it needs a boolean, not a width, and it needs it on the first paint:
 * `useMediaQuery` reads during render, which is what keeps a reload from
 * flashing the wrong one.
 *
 * The number is the same 768 the shell used before the sidebar arrived
 * (`SIDEBAR_MIN_WIDTH` in AppShell) — at that width the chat still gets a real
 * column beside a 300px panel.
 */
export const MOBILE_BREAKPOINT = 768;

export function useIsMobile(): boolean {
  return useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
}

/**
 * Width of the scrollbar gutter a scroller has reserved, in px, plus the ref to
 * put on that scroller.
 *
 * `scrollbar-gutter: stable` holds that space open whether or not the scrollbar
 * is currently showing, which is what lets an overlay stop sitting on top of the
 * scroll control. The reserved width is *not* a constant: it is 0 on a platform
 * with overlay scrollbars until the gutter is asked for, ~15px with classic ones
 * on Linux and Windows, and 0 on macOS. So it has to be measured rather than
 * hardcoded, and re-measured on resize because the OS scrollbar preference can
 * change between sessions.
 *
 * This returns a *callback ref* rather than taking one, and that matters. The
 * scroller lives in a conditional branch of the chat screen's render, so a
 * plain ref plus a mount effect measures nothing: the effect runs during the
 * first render, that render has no scroller, and the value is 0 forever. A
 * callback ref fires when the element actually attaches, and again on resize.
 *
 *   const { scrollerRef, gutter } = useScrollbarGutter();
 *   <div ref={scrollerRef} className="[scrollbar-gutter:stable]" />
 */
export function useScrollbarGutter(): { scrollerRef: (el: HTMLElement | null) => void; gutter: number } {
  const [gutter, setGutter] = useState(0);
  // A callback ref cannot return a cleanup, so the listener it installs is torn
  // down here instead: on the next attach, and on unmount.
  const attached = useRef<{ el: HTMLElement; onResize: () => void } | null>(null);
  useEffect(
    () => () => {
      attached.current?.el.removeEventListener('resize', attached.current.onResize);
      attached.current = null;
    },
    [],
  );
  const scrollerRef = useCallback((el: HTMLElement | null) => {
    attached.current?.el.removeEventListener('resize', attached.current.onResize);
    attached.current = null;
    if (!el) {
      setGutter(0);
      return;
    }
    // The gutter is fixed once the element exists and does not vary with its
    // content, so the initial read plus a resize listener is enough.
    const read = () => setGutter(el.offsetWidth - el.clientWidth);
    read();
    el.addEventListener('resize', read);
    attached.current = { el, onResize: read };
  }, []);
  return { scrollerRef, gutter };
}
