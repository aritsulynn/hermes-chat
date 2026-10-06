import { useEffect, useRef, useState } from 'react';

/**
 * `condition`, but only once it has held for `delayMs` of *visible* time.
 *
 * This exists for one caller: the connection banner. On Android every app
 * switch kills the WebView socket (1006), so `conn` runs
 * ready → reconnecting → ready on the way back in. Most of those recover on
 * their own within a few seconds of the app returning, and the strip's
 * slide-in and slide-out during that window is what the user sees as "the app
 * reloaded". An outage nobody can perceive is not worth a notification.
 *
 * A plain `setTimeout` is not enough, and that is the bug this hook used to
 * have. The drop is usually detected while the app is in the background, and
 * React still mounts the timer there — on Android that frozen timer fires the
 * instant the app returns, so the strip surfaced immediately no matter how
 * long `delayMs` was. Two rules make the window honest:
 *
 *  - Time spent hidden does not count. The clock only runs while
 *    `document.visibilityState` is visible.
 *  - A drop that begins around a resume (while hidden, or within
 *    `resumeWindowMs` of the app coming forward) is expected and earns the
 *    longer `resumeDelayMs`. A drop during active use keeps the short
 *    `delayMs`, so a real outage is still reported promptly.
 *
 * Once shown, `shown` stays true until `condition` clears: re-arming on every
 * flap would strobe the strip.
 */
export function useGrace(
  condition: boolean,
  delayMs: number,
  resumeDelayMs: number = delayMs,
  resumeWindowMs = 0,
): boolean {
  const [shown, setShown] = useState(false);
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible',
  );
  const resumedAt = useRef(0);

  // Visibility is the resume signal; window focus is the fallback for shells
  // whose WebView does not propagate the Page Visibility state.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const show = () => {
      resumedAt.current = Date.now();
      setVisible(true);
    };
    const hide = () => setVisible(false);
    const onVisibility = () => (document.visibilityState === 'visible' ? show() : hide());
    document.addEventListener('visibilitychange', onVisibility);
    globalThis.addEventListener?.('focus', show);
    globalThis.addEventListener?.('blur', hide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      globalThis.removeEventListener?.('focus', show);
      globalThis.removeEventListener?.('blur', hide);
    };
  }, []);

  useEffect(() => {
    if (!condition) {
      setShown(false);
      return;
    }
    if (shown) return;
    // Hidden time does not count — see the note above.
    if (!visible) return;
    const resumeOrigin = resumeWindowMs > 0 && Date.now() - resumedAt.current <= resumeWindowMs;
    const timer = setTimeout(() => setShown(true), resumeOrigin ? resumeDelayMs : delayMs);
    return () => clearTimeout(timer);
  }, [condition, visible, delayMs, resumeDelayMs, resumeWindowMs, shown]);

  return condition && shown;
}
