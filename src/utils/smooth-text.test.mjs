import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAIN_SECONDS,
  MAX_CHARS_PER_SEC,
  MIN_CHARS_PER_SEC,
  advanceReveal,
  continuesCluster,
  safeCut,
} from './smooth-text.ts';

const FRAME = 1 / 60;

test('advanceReveal holds still when there is nothing new', () => {
  assert.equal(advanceReveal(10, 10, FRAME), 10);
  assert.equal(advanceReveal(0, 0, FRAME), 0);
  // A stale position behind a shorter text clamps rather than running backwards.
  assert.equal(advanceReveal(20, 5, FRAME), 5);
});

test('advanceReveal is bounded, monotonic and never overruns the text', () => {
  assert.ok(advanceReveal(0, 3, 10) <= 3);
  for (let dt = 0.001; dt < 1; dt += 0.001) {
    const next = advanceReveal(4, 10, dt);
    assert.ok(next >= 4 && next <= 10, `dt ${dt} gave ${next}`);
  }
  // A huge backlog still advances by at most MAX_CHARS_PER_SEC per second.
  assert.ok(advanceReveal(0, 100000, 1) <= MAX_CHARS_PER_SEC);
});

test('safeCut never lands inside a combining mark', () => {
  // Thai: a consonant with a tone mark, then a plain consonant.
  const full = 'ก่x';
  for (let at = 0; at <= full.length; at += 0.05) {
    const cut = safeCut(full, at);
    if (cut > 0 && cut < full.length) {
      assert.equal(continuesCluster(full[cut]), false, `cut ${cut} for position ${at}`);
    }
  }
  // And a lone high surrogate is never left dangling.
  assert.equal(safeCut('😀x', 1), 2);
});

test('a bursty producer is revealed on an even cadence', () => {
  const BURST_CHARS = 18;
  const BURST_EVERY = 0.25; // seconds — a model that emits in clumps with pauses
  const BURSTS = 20;

  let full = 0;
  let revealed = 0;
  let shown = 0;
  let bursts = 0;
  const changes = [];
  let t = 0;

  for (let i = 0; i < 60 * 8; i++) {
    t += FRAME;
    if (bursts < BURSTS && t >= (bursts + 1) * BURST_EVERY) {
      full += BURST_CHARS;
      bursts += 1;
    }
    revealed = advanceReveal(revealed, full, FRAME);
    const cut = safeCut('x'.repeat(full), revealed);
    if (cut > shown) {
      shown = cut;
      changes.push(t);
    }
  }

  // The producer really is bursty: 250ms between clumps.
  assert.ok(BURST_EVERY * 1000 >= 200);

  // The reveal is not: every visible step is within a couple of frames.
  let maxGap = 0;
  for (let i = 1; i < changes.length; i++) maxGap = Math.max(maxGap, changes[i] - changes[i - 1]);
  assert.ok(maxGap < 0.05, `max reveal gap was ${(maxGap * 1000).toFixed(0)}ms, wanted under 50ms`);

  // And it keeps up: the whole answer is out shortly after the last clump.
  assert.equal(shown, full, 'everything arrives');
});

test('the reveal trails the producer by about DRAIN_SECONDS, not more', () => {
  // A steady producer at 90 characters a second.
  const PER_FRAME = 90 * FRAME;
  let full = 0;
  let revealed = 0;
  let worst = 0;
  for (let i = 0; i < 60 * 5; i++) {
    full += PER_FRAME;
    revealed = advanceReveal(revealed, full, FRAME);
    worst = Math.max(worst, full - revealed);
  }
  // DRAIN_SECONDS worth of characters, plus the floor's own lag.
  assert.ok(worst <= 90 * DRAIN_SECONDS + MIN_CHARS_PER_SEC * FRAME * 2 + 1, `trailed by ${worst.toFixed(1)} chars`);
  assert.ok(full - revealed > 0, 'it does lag, rather than snapping');
});
