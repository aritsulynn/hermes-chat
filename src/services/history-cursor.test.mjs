// Reconnect resync spec.
//
// A reconnect resync fetches the newest page from REST and folds it into the
// loaded window instead of replacing it. Replacing the window with one page
// collapses a deep history window, which clamps the scroller to the bottom and
// yanks a reader who was scrolled up (the "it goes to latest on resume" bug).

import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeHistoryTail } from '../utils/messages.ts';

test('a reconnect resync folds the fresh tail into the window instead of shrinking it', () => {
  const current = [
    { id: 'a', role: 'user', rowId: 1, text: 'u1' },
    { id: 'b', role: 'assistant', rowId: 2, text: 'a1' },
    { id: 'c', role: 'user', rowId: 3, text: 'u2' },
    { id: 'd', role: 'assistant', rowId: 4, text: 'a2' },
  ];
  // The newest page overlaps the window's tail and carries two newer rows.
  const fresh = [
    { id: 'x', role: 'user', rowId: 3, text: 'u2' },
    { id: 'y', role: 'assistant', rowId: 4, text: 'a2' },
    { id: 'z', role: 'user', rowId: 5, text: 'u3' },
    { id: 'w', role: 'assistant', rowId: 6, text: 'a3' },
  ];
  const merged = mergeHistoryTail(current, fresh);
  assert.deepEqual(
    merged.map((m) => m.rowId),
    [1, 2, 3, 4, 5, 6],
    'older rows are kept and only genuinely newer rows are appended',
  );
  // Existing rows keep their identity (no remount, scroll anchor holds).
  assert.equal(merged[0], current[0]);
  assert.equal(merged[3], current[3]);
});
