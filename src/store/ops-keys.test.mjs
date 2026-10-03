import assert from 'node:assert/strict';
import test from 'node:test';

import { isSuperseded, opsKey } from './ops-keys.ts';

// The scope is appended by the hooks, so these tests pin the two pure pieces
// that the screens depend on: the key prefix, and the one error that must never
// reach a screen or trigger a retry.

test('opsKey prefixes every entry under a single root', () => {
  assert.deepEqual(opsKey('webhooks'), ['ops', 'webhooks']);
  assert.deepEqual(opsKey('kanban', 'board', 'main'), ['ops', 'kanban', 'board', 'main']);
  assert.deepEqual(opsKey(), ['ops']);
});

test('different screens never collide on the same key', () => {
  assert.notDeepEqual(opsKey('cron', 'jobs'), opsKey('cron', 'runs'));
});

test('a superseded fetch is recognised as a non-failure', () => {
  assert.equal(isSuperseded(new Error('Connection superseded')), true);
});

test('real failures are not mistaken for a superseded fetch', () => {
  assert.equal(isSuperseded(new Error('GET /api/webhooks → HTTP 500')), false);
  // Same message on a non-Error: the transport always throws Error, so a bare
  // string must not slip through the guard.
  assert.equal(isSuperseded('Connection superseded'), false);
  assert.equal(isSuperseded(undefined), false);
  assert.equal(isSuperseded(null), false);
});
