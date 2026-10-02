import { useEffect, useState } from 'react';

/**
 * `condition`, but only after it has held for `delayMs`.
 *
 * This exists for one caller: the connection banner. On Android every app
 * switch kills the WebView socket (1006), so `conn` runs
 * ready → reconnecting → ready on the way back in. Most of those recover inside
 * half a second — a fresh ticket plus one dial — and the strip's slide-in and
 * slide-out during that window is what the user sees as "the app reloaded".
 * An outage nobody can perceive is not worth a notification, so the banner
 * stays down until the drop proves itself.
 *
 * False is sticky: once a condition has been reported as real, clearing it
 * immediately (and re-arming the delay) would make a flapping socket strobe the
 * strip. Reset only happens when the condition goes false again.
 */
export function useGrace(condition: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!condition) {
      setShown(false);
      return;
    }
    if (shown) return;
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [condition, delayMs, shown]);

  return condition && shown;
}
