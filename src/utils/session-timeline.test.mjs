import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTimelineIndex, mergeTimelinePage } from './session-timeline.ts';

// The gateway's /timeline returns prompt metadata only — row_id, a truncated
// preview, a timestamp — paginated by a `next_cursor` that is a logical
// first-row id rather than the entry's own row_id. These tests pin the cursor
// arithmetic, because getting it wrong silently skips or repeats prompts: the
// cursor is the last entry's `sort_id`, which the client is never told about,
// so it has to be the entry it *is* told about.

test('a first page with more to come reports the cursor to resume from', () => {
  const page = buildTimelineIndex({
    entries: [
      { row_id: 7, preview: 'a', timestamp: 1 },
      { row_id: 9, preview: 'b', timestamp: 2 },
    ],
    pagination: { limit: 2, after_row_id: 0, returned: 2, total: 5, has_more: true, next_cursor: 9 },
  });
  assert.equal(page.entries.length, 2);
  assert.equal(page.total, 5);
  // The last entry's own row_id, which is what the server echoed back as
  // next_cursor. Resuming from the entry row_id here is the whole point.
  assert.equal(page.cursor, 9);
  assert.equal(page.hasMore, true);
});

test('the last page has no cursor and no more', () => {
  const page = buildTimelineIndex({
    entries: [{ row_id: 3, preview: 'z', timestamp: 9 }],
    pagination: { limit: 500, after_row_id: 0, returned: 1, total: 1, has_more: false, next_cursor: null },
  });
  assert.equal(page.cursor, null);
  assert.equal(page.hasMore, false);
});

test('an empty page keeps the total so the UI can still say how long it is', () => {
  const page = buildTimelineIndex({
    entries: [],
    pagination: { limit: 500, after_row_id: 99999, returned: 0, total: 4, has_more: false, next_cursor: null },
  });
  assert.deepEqual(page.entries, []);
  assert.equal(page.total, 4);
  assert.equal(page.cursor, null);
});

test('entries without a preview are dropped — the server already filters, this is belt and braces', () => {
  const page = buildTimelineIndex({
    entries: [
      { row_id: 1, preview: 'kept', timestamp: 1 },
      { row_id: 2, preview: '', timestamp: 2 },
    ],
    pagination: { limit: 500, after_row_id: 0, returned: 2, total: 2, has_more: false, next_cursor: null },
  });
  assert.deepEqual(
    page.entries.map((e) => e.rowId),
    [1],
  );
});

test('a malformed entry is dropped rather than rendering an unusable row', () => {
  const page = buildTimelineIndex({
    entries: [
      null,
      { row_id: 'x', preview: 'no numeric id', timestamp: 1 },
      { row_id: 4, preview: 'ok', timestamp: 2 },
    ],
    pagination: { limit: 500, after_row_id: 0, returned: 3, total: 3, has_more: false, next_cursor: null },
  });
  assert.deepEqual(
    page.entries.map((e) => e.rowId),
    [4],
  );
});

test('paging forward appends and dedupes on row_id', () => {
  const first = buildTimelineIndex({
    entries: [
      { row_id: 1, preview: 'a', timestamp: 1 },
      { row_id: 2, preview: 'b', timestamp: 2 },
    ],
    pagination: { limit: 2, after_row_id: 0, returned: 2, total: 4, has_more: true, next_cursor: 2 },
  });
  const second = buildTimelineIndex({
    entries: [
      { row_id: 2, preview: 'b', timestamp: 2 },
      { row_id: 3, preview: 'c', timestamp: 3 },
    ],
    pagination: { limit: 2, after_row_id: 2, returned: 2, total: 4, has_more: true, next_cursor: 3 },
  });
  const merged = mergeTimelinePage(first, second);
  // row_id 2 appears in both pages — the server's cursor is a first-row id and
  // the entry that carries it comes back on the next page. Rendering it twice
  // would show a phantom duplicate prompt.
  assert.deepEqual(
    merged.entries.map((e) => e.rowId),
    [1, 2, 3],
  );
  assert.equal(merged.cursor, 3);
  assert.equal(merged.hasMore, true);
});

test('merging is a no-op when the next page adds nothing new', () => {
  const first = buildTimelineIndex({
    entries: [{ row_id: 1, preview: 'a', timestamp: 1 }],
    pagination: { limit: 500, after_row_id: 0, returned: 1, total: 1, has_more: false, next_cursor: null },
  });
  const again = buildTimelineIndex({
    entries: [{ row_id: 1, preview: 'a', timestamp: 1 }],
    pagination: { limit: 500, after_row_id: 0, returned: 1, total: 1, has_more: false, next_cursor: null },
  });
  const merged = mergeTimelinePage(first, again);
  assert.equal(merged.entries.length, 1);
  assert.equal(merged.cursor, null);
});

test('the total follows the newest page, so a resume does not shrink the count', () => {
  const first = buildTimelineIndex({
    entries: [{ row_id: 1, preview: 'a', timestamp: 1 }],
    pagination: { limit: 1, after_row_id: 0, returned: 1, total: 1, has_more: true, next_cursor: 1 },
  });
  const second = buildTimelineIndex({
    entries: [{ row_id: 2, preview: 'b', timestamp: 2 }],
    pagination: { limit: 1, after_row_id: 1, returned: 1, total: 2, has_more: false, next_cursor: null },
  });
  const merged = mergeTimelinePage(first, second);
  // The gateway recounts on every page (`SELECT COUNT(*) ... AS total` inside the
  // same snapshot), so the later number is the authoritative one — compaction can
  // land between pages and move it either way.
  assert.equal(merged.total, 2);
});
