// Viewport size, tracked live. Replaces RN's `useWindowDimensions`.
//
// Not a constant read at mount: the chat screen's bubble width is a percentage
// of the window and its composer listens to the visual viewport, so both have
// to react to a resize, a rotation, or a mobile browser's address bar
// collapsing.
import { useEffect, useState } from 'react';

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
 * Drop focus from whatever has it. This is what `Keyboard.dismiss()` did: on
 * the web, "dismiss the keyboard" is "blur the focused element".
 *
 * It is exported rather than inlined because a few call sites need it inside a
 * `useCallback` that must not capture a changing element, and `document` is the
 * one thing that is always the same.
 */
export function blurActiveElement(): void {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}
