import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeUsage } from './usage.ts';

test('fills missing context fields from another usage snapshot', () => {
  assert.deepEqual(
    mergeUsage(
      { input: 1200, output: 80, total: 1280 },
      { context_used: 42_000, context_max: 200_000, context_percent: 21 },
    ),
    {
      contextPercent: 21,
      contextUsed: 42_000,
      contextMax: 200_000,
      total: 1280,
      input: 1200,
      output: 80,
    },
  );
});

test('later snapshots override stale values while preserving absent fields', () => {
  assert.deepEqual(
    mergeUsage(
      { context_percent: 21, input: 1200 },
      { context_percent: 25 },
    ),
    { contextPercent: 25, input: 1200 },
  );
});

test('keeps a real zero-percent snapshot', () => {
  assert.deepEqual(mergeUsage(null, { context_percent: 0 }), { contextPercent: 0 });
});
