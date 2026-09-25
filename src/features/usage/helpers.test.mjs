import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeToolSkillList } from './helpers.ts';

test('normalizes array payloads', () => {
  assert.deepEqual(normalizeToolSkillList(['a', { tool: 'b', count: 3 }], 'tool'), [
    { name: 'a', count: 1 },
    { name: 'b', count: 3, percentage: undefined },
  ]);
});

test('normalizes object payloads', () => {
  assert.deepEqual(normalizeToolSkillList({ a: 2, b: { count: 5 } }, 'tool'), [
    { name: 'a', count: 2 },
    { name: 'b', count: 5, percentage: undefined },
  ]);
});

test('returns empty for missing input', () => {
  assert.deepEqual(normalizeToolSkillList(null, 'tool'), []);
});
