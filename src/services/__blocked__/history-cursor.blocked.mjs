// P2 — BLOCKED specs (backend immutable).
//
// These encode the full cursor/identity contract. The existing backend does NOT
// expose the fields or params they need (docs/chat-history-p2-feasibility.md):
//
//   * stable displayId / displayOrder  -> not on any REST row
//   * before / after cursor + nextCursor / prevCursor / hasMore -> not supported
//   * message_uid on WS history/live   -> not exposed
//   * a robust history/live merge that needs a stable logical identity
//
// They are kept RED and are run explicitly:
//
//   npm run test:p2
//
// They are NOT part of `npm test`. Do not "fix" them by inventing a client-side
// displayId/cursor/message_uid — they pass only when the backend exposes the
// contract.

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync(new URL('../__fixtures__/p2-golden.json', import.meta.url), 'utf8'));
const canonical = fixture.canonical;
const raw = fixture.rawRows;
const page = fixture.currentServerPage;

test('BLOCKED: every history row exposes a stable displayId', () => {
  assert.ok(page.messages.length > 0);
  for (const m of page.messages) {
    assert.ok(typeof m.displayId === 'string' && m.displayId, 'BLOCKED: backend exposes no displayId');
  }
});

test('BLOCKED: displayId collapses duplicate generations to one logical message', () => {
  const ids = new Set(canonical.map((m) => m.displayId));
  assert.equal(ids.size, canonical.length, 'BLOCKED: canonical has no displayId');
  assert.ok(canonical.length < raw.filter((r) => !r.modelOnly).length, 'BLOCKED');
});

test('BLOCKED: history rows carry a monotonic displayOrder', () => {
  for (const m of page.messages) {
    assert.equal(typeof m.displayOrder, 'number', 'BLOCKED: backend exposes no displayOrder');
  }
});

test('BLOCKED: a page never returns the same displayId twice', () => {
  const ids = page.messages.map((m) => m.displayId);
  assert.equal(new Set(ids).size, ids.length, 'BLOCKED: no displayId to dedupe on');
});

test('BLOCKED: history exposes displayId and live frames expose message_uid as distinct keys', () => {
  for (const m of page.messages) {
    assert.ok(typeof m.message_uid === 'string' && m.message_uid, 'history keeps message_uid');
    assert.notEqual(m.displayId, m.message_uid, 'BLOCKED: no displayId');
  }
  assert.ok(fixture.liveFrame, 'BLOCKED: live frames expose no durable message_uid');
});

test('BLOCKED: page exposes nextCursor/prevCursor/hasMore and before=<cursor>', () => {
  assert.ok(typeof page.nextCursor === 'string' && page.nextCursor, 'BLOCKED: no nextCursor');
  assert.ok(typeof page.prevCursor === 'string' && page.prevCursor, 'BLOCKED: no prevCursor');
  assert.equal(typeof page.hasMore, 'boolean', 'BLOCKED: no hasMore');
  assert.ok(fixture.beforePage, 'BLOCKED: no before=<cursor>');
});

test('BLOCKED: a stale cursor is reported stale, not silently wrong', () => {
  assert.ok(fixture.staleCursor, 'BLOCKED: backend has no cursor to be stale');
  assert.equal(fixture.staleCursor.stale, true);
});

test('BLOCKED: reconnect merge by displayId does not duplicate', () => {
  assert.ok(fixture.reconnectPage, 'BLOCKED: no displayId to merge on');
  const merged = new Map();
  for (const m of [...page.messages, ...fixture.reconnectPage.messages]) merged.set(m.displayId, m);
  assert.equal(merged.size, page.messages.length);
});

test('BLOCKED: a live frame during a history read is not lost or duplicated (stable identity)', () => {
  assert.ok(fixture.liveFrame, 'BLOCKED: live frames expose no durable message_uid');
});
