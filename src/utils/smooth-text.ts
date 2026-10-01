// The cadence half of the streaming reveal.
//
// A real model does not emit text evenly: tokens arrive in bursts with gaps
// between them, so an answer lands in clumps no matter how fast the renderer is.
// shadcn's chat demos look smooth because their text is produced on a fixed
// cadence — their `writer.text()` helper streams "word by word by default" with
// a `delayMs`, and the docs' own transcript says streaming there "is simulated".
// Translating that look onto a real stream means holding whatever has arrived in
// a backlog and revealing it at a rate derived from that backlog.
//
// The maths lives here, with no React and no timers, so it can be pinned by
// tests; components/chat/use-smooth-text.ts drives it from requestAnimationFrame.

/** Never crawl: even a two-character backlog keeps moving. */
export const MIN_CHARS_PER_SEC = 22;
/** Never lurch: caps the catch-up so a late burst cannot arrive all at once. */
export const MAX_CHARS_PER_SEC = 1400;
/** How long a backlog takes to drain. This is the lag behind the model. */
export const DRAIN_SECONDS = 0.25;
/** Longest frame we integrate over — a backgrounded tab must not jump on return. */
export const MAX_FRAME_SECONDS = 0.1;

/**
 * Does this character continue the one before it?
 *
 * A reveal point that lands inside a grapheme cluster renders a broken glyph and
 * then reflows when the rest arrives — most visibly in Thai, where a consonant
 * without its tone mark or vowel sign is not a wrong letter so much as a
 * different-looking one. Combining marks, ZWJ, variation selectors and a lone
 * low surrogate (the tail of a pair) all continue their predecessor.
 */
export function continuesCluster(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x0300 && c <= 0x036f) || // combining diacritics
    (c >= 0x0e31 && c <= 0x0e3a) || // Thai vowel signs and mai han akat
    (c >= 0x0e47 && c <= 0x0e4e) || // Thai tone marks and friends
    c === 0x200d || // zero-width joiner
    (c >= 0xfe00 && c <= 0xfe0f) || // variation selectors
    (c >= 0xdc00 && c <= 0xdfff) // low surrogate — the tail of a pair
  );
}

/**
 * The reveal position after one frame, as a FRACTIONAL character count.
 *
 * Fractional on purpose: whole-character stepping quantises the rate to 60, 120,
 * 180… characters a second, so the backlog oscillates and the speed visibly
 * sawtooths. Carrying the fraction lets the rate settle wherever the producer
 * actually is.
 *
 * The rate is proportional to the backlog with a floor and a ceiling, so the
 * text trails the model by about DRAIN_SECONDS and no more, a trickle still
 * moves, and a late burst eases in instead of arriving at once.
 */
export function advanceReveal(revealed: number, total: number, dt: number): number {
  const backlog = total - revealed;
  if (backlog <= 0) return total;
  const perSec = Math.min(MAX_CHARS_PER_SEC, Math.max(MIN_CHARS_PER_SEC, backlog / DRAIN_SECONDS));
  return Math.min(total, revealed + perSec * Math.min(dt, MAX_FRAME_SECONDS));
}

/**
 * The visible cut for a fractional reveal position, pushed forward past any
 * combining mark so a cluster is never revealed in halves.
 */
export function safeCut(full: string, revealed: number): number {
  let cut = Math.min(full.length, Math.floor(revealed));
  while (cut < full.length && continuesCluster(full[cut])) cut += 1;
  return cut;
}
