import assert from 'node:assert/strict';
import test from 'node:test';

import { asLogLines, classifyLine } from './helpers.ts';

test('classifyLine reads the leading level token', () => {
  assert.equal(classifyLine('2026-09-26 10:00:00 ERROR boom'), 'error');
  assert.equal(classifyLine('2026-09-26 10:00:00 WARNING hmm'), 'warning');
  assert.equal(classifyLine('2026-09-26 10:00:00 DEBUG dbg'), 'debug');
  assert.equal(classifyLine('2026-09-26 10:00:00 INFO hi'), 'info');
});

test('classifyLine falls back to a keyword scan without a token', () => {
  assert.equal(classifyLine('Traceback (most recent call last):'), 'error');
  assert.equal(classifyLine('something ERROR happened'), 'error');
  assert.equal(classifyLine('a warning here'), 'warning');
  assert.equal(classifyLine('plain line'), 'info');
});

test('asLogLines keeps strings and drops anything else', () => {
  assert.deepEqual(asLogLines({ lines: ['a', 'b'] }), ['a', 'b']);
  // A half-written line can arrive as an object; the list interpolates every
  // entry into a <div>, so a non-string must not survive.
  assert.deepEqual(asLogLines({ lines: ['a', { text: 'b' }, 3, null] }), ['a']);
});

test('asLogLines reads a missing or malformed payload as no lines', () => {
  assert.deepEqual(asLogLines({}), []);
  assert.deepEqual(asLogLines({ lines: 'a' }), []);
  assert.deepEqual(asLogLines(null), []);
  assert.deepEqual(asLogLines(['a']), []);
});
