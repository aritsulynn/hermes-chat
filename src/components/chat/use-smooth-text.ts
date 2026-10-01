// Drives the streaming reveal from requestAnimationFrame.
//
// The cadence itself is in utils/smooth-text.ts, with no React and no timers, so
// it can be pinned by tests. This is only the loop around it: keep whatever has
// arrived in a backlog and reveal a little more each frame.
//
// What it cannot fix: an input that is genuinely sparse. If the model itself
// only emits a few characters a second there is nothing to reveal in between,
// and this idles rather than inventing text — that floor is the model's.
import { useEffect, useRef, useState } from 'react';
import { advanceReveal, safeCut } from '../../utils/smooth-text';

/**
 * @param text    everything received so far
 * @param pending whether the turn is still running — while it is, the ticker
 *                keeps going even with an empty backlog, so the next burst is
 *                picked up on the following frame
 */
export function useSmoothText(text: string, pending: boolean | undefined): string {
  const [shown, setShown] = useState(text);
  const target = useRef(text);
  const revealed = useRef(text.length);
  const frame = useRef<number | null>(null);
  const lastAt = useRef(0);
  const live = useRef(!!pending);
  target.current = text;
  live.current = !!pending;

  // Cancel AND clear: `frame.current` doubles as the "ticker is running" flag,
  // and a cancelled handle left behind would stop every later wake-up. React's
  // StrictMode runs this cleanup once on mount, so this is not hypothetical.
  const stop = useRef(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    lastAt.current = 0;
  }).current;

  // Reveal everything at once. A hidden tab gets no animation frames, so
  // smoothing there would freeze the text part-way and then "type out" stale
  // content whenever the reader came back. Nobody is watching: be correct on
  // return instead.
  const settle = useRef(() => {
    revealed.current = target.current.length;
    setShown(target.current);
    stop();
  }).current;

  const start = useRef(() => {
    if (frame.current !== null) return;
    const tick = (now: number) => {
      frame.current = null;
      if (document.hidden) {
        settle();
        return;
      }
      const full = target.current;
      if (revealed.current > full.length) revealed.current = full.length;
      const dt = lastAt.current ? (now - lastAt.current) / 1000 : 1 / 60;
      lastAt.current = now;
      revealed.current = advanceReveal(revealed.current, full.length, dt);
      const cut = safeCut(full, revealed.current);
      // A repeat slice is the same string, so React bails out of the render.
      setShown(full.slice(0, cut));
      if (live.current || revealed.current < target.current.length) {
        frame.current = requestAnimationFrame(tick);
      } else {
        lastAt.current = 0;
      }
    };
    frame.current = requestAnimationFrame(tick);
  }).current;

  // Wake the ticker on a fresh token, or while a turn is live.
  useEffect(() => {
    if (live.current || revealed.current < text.length) start();
  }, [text, pending, start]);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) settle();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [settle]);

  // `shown` is a prefix of an earlier `text`; text only grows, so it is still a
  // prefix — except across a regenerate, where the clamp keeps it honest.
  return shown.length > text.length ? text : shown;
}
