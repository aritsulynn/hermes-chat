import { useCallback, useEffect, useRef } from 'react';

type LongPressOptions = {
  /** How long the press has to last before it counts. */
  delay?: number;
  /** How far a pointer may drift before it stops counting as a press. */
  moveTolerance?: number;
};

/**
 * Long-press for the web, because the app was built around it.
 *
 * Four call sites depend on it — delete a session row, copy a message, retry a
 * failed tool call — and on touch devices long-press is the only affordance
 * they had. Replacing them with hover-only or "always visible" controls would
 * change how the app works rather than how it looks, so the gesture is
 * reproduced instead.
 *
 * Pointer Events are used rather than touch/mouse pairs so one implementation
 * covers mouse, touch and pen.
 *
 * `onContextMenu` is suppressed because the browser's own long-press callout
 * (text selection / share sheet) fires at roughly the same moment and would
 * cover the action. That suppression is the one behaviour change: on a real
 * touch device the OS callout no longer appears over pressable rows. Text
 * inside ordinary paragraphs is unaffected — only elements that actually pass
 * `onLongPress` opt in.
 */
export function useLongPress(onLongPress: () => void, options: LongPressOptions = {}) {
  const { delay = 500, moveTolerance = 10 } = options;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // Held in a ref so the pointer handlers below can stay referentially stable
  // and not re-attach on every render for a long-press that may fire much
  // later than the render that created it.
  const handler = useRef(onLongPress);
  handler.current = onLongPress;

  const cancel = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: useCallback(
      (e: React.PointerEvent) => {
        // Ignore secondary buttons so a right-click does not fire the gesture.
        if (e.button !== 0) return;
        origin.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => {
          timer.current = null;
          handler.current();
        }, delay);
      },
      [cancel, delay],
    ),
    onPointerMove: useCallback(
      (e: React.PointerEvent) => {
        const o = origin.current;
        if (!o || !timer.current) return;
        if (Math.abs(e.clientX - o.x) > moveTolerance || Math.abs(e.clientY - o.y) > moveTolerance) cancel();
      },
      [cancel, moveTolerance],
    ),
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onContextMenu: useCallback((e: React.MouseEvent) => e.preventDefault(), []),
  };
}
