import assert from 'node:assert/strict';
import test from 'node:test';

import { isLiveStatus } from './live-sessions.ts';

test('isLiveStatus keeps the statuses worth showing and drops the rest', () => {
  // The three states `session.active_list` reports for a session doing work.
  assert.equal(isLiveStatus('working'), true);
  assert.equal(isLiveStatus('waiting'), true);
  assert.equal(isLiveStatus('starting'), true);
  // `idle` is the absence of work, and the RPC documents nothing else — a new
  // status must not silently start animating a row.
  assert.equal(isLiveStatus('idle'), false);
  assert.equal(isLiveStatus(''), false);
  assert.equal(isLiveStatus('WORKING'), false);
});
