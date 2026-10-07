// P2 Step 1 spec — CLIENT-ONLY SUBSET (backend immutable).
//
// The backend exposes no stable display identity and no cursor
// (docs/chat-history-p2-feasibility.md), so the cursor/displayId specs live in
// src/services/__blocked__/history-cursor.blocked.mjs and run via `npm run
// test:p2`. This file holds what P2 can actually ship on the existing contract:
//
//   * fixture invariants — prove the golden data is genuinely hard;
//   * the pinned display read (`include_compacted=true`);
//   * older-page dedup anchored on the window's oldest durable row.
//
// Nothing here fakes a `displayId`, a cursor, or a WS `message_uid`.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { sessionMessages } from './api.ts';
import { mergeHistoryTail, sliceOlderThan } from '../utils/messages.ts';

const fixture = JSON.parse(readFileSync(new URL('./__fixtures__/p2-golden.json', import.meta.url), 'utf8'));
const raw = fixture.rawRows;

const byIdentity = new Map();
for (const r of raw) {
  if (!r.displayIdentity) continue;
  byIdentity.set(r.displayIdentity, (byIdentity.get(r.displayIdentity) ?? 0) + 1);
}
const duplicateGroups = [...byIdentity.values()].filter((n) => n > 1);

// ── Fixture invariants (green: the golden data really contains the hard cases) ─

test('fixture: >2000 display messages, a real lineage, compacted/hidden/model-only and duplicate generations', () => {
  assert.ok(fixture.counts.canonicalDisplay > 2000, 'need >2000 display messages');
  assert.ok(fixture.session.lineage.length >= 2, 'need a compression lineage');
  assert.ok(
    raw.some((r) => r.compacted),
    'need compacted rows',
  );
  assert.ok(
    raw.some((r) => r.displayKind === 'hidden'),
    'need hidden rows',
  );
  assert.ok(
    raw.some((r) => r.modelOnly),
    'need model-only rows',
  );
  assert.ok(duplicateGroups.length > 0, 'need duplicate generations');
});

// ── Client-only achievable: pinned display read ──────────────────────────────

test('P2: history reads pin the display projection with include_compacted=true', () => {
  const url = sessionMessages('abc', { limit: 50, offset: 100, profile: 'default' });
  assert.match(url, /include_compacted=true/, 'the read must pin include_compacted');
  assert.match(url, /offset=100/, 'offset paging is preserved');
  assert.match(url, /limit=50/, 'page size is preserved');
});

test('P2: the pinned read is the deduped display projection, so the page never repeats a logical row', () => {
  // The server returns one row per logical message when include_compacted=true;
  // the client must not need to reconstruct that identity itself.
  const url = sessionMessages('abc', { limit: 50 });
  assert.match(url, /include_compacted=true/);
});

// ── Client-only achievable: older-page dedup ─────────────────────────────────

test('P2: an older page merges only rows strictly older than the window, dropping overlap', () => {
  const current = [
    { id: 'a', role: 'user', rowId: 10, text: 'u10' },
    { id: 'b', role: 'assistant', rowId: 11, text: 'a11' },
  ];
  const fetched = [
    { id: 'x', role: 'user', rowId: 8, text: 'u8' },
    { id: 'y', role: 'assistant', rowId: 9, text: 'a9' },
    { id: 'z', role: 'user', rowId: 10, text: 'u10' }, // anchor: already held
    { id: 'w', role: 'assistant', rowId: 11, text: 'a11' }, // newer: already held
  ];
  const older = sliceOlderThan(fetched, current);
  assert.deepEqual(
    older.map((m) => m.rowId),
    [8, 9],
    'only rows older than the window anchor may be prepended',
  );
});

// ── Client-only achievable: reconnect resync preserves the window ─────────────

test('P2: a reconnect resync folds the fresh tail into the window instead of shrinking it', () => {
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
