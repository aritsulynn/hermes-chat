import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadTranscriptTail,
  saveTranscriptTail,
  toCachedTail,
  transcriptTailKey,
  TRANSCRIPT_TAIL_MAX,
} from './transcript-cache.ts';

function stubStorage() {
  const map = new Map();
  const store = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true });
  return { map, store };
}

test('tails are scoped per account, profile and session', () => {
  const a = transcriptTailKey('h@u', 'default', 's1');
  const b = transcriptTailKey('h@u', 'default', 's2');
  const c = transcriptTailKey('other@u', 'default', 's1');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

test('toCachedTail drops ephemeral rows and keeps durable keys', () => {
  const tail = toCachedTail([
    { id: 'a', role: 'user', text: 'hi', rowId: 7, ts: 1 },
    { id: 'b', role: 'assistant', text: '', pending: true },
    { id: 'c', role: 'interim', text: 'typing…' },
    { id: 'd', role: 'notice', text: 'released the stop button' },
    { id: 'e', role: 'assistant', text: 'done', rowId: 8 },
  ]);
  assert.deepEqual(
    tail.map((m) => [m.role, m.text, m.rowId ?? null]),
    [
      ['user', 'hi', 7],
      ['assistant', 'done', 8],
    ],
  );
});

test('toCachedTail keeps one page and clips giant outputs', () => {
  const rows = Array.from({ length: TRANSCRIPT_TAIL_MAX + 10 }, (_, i) => ({
    id: `m${i}`,
    role: 'user',
    text: `t${i}`,
  }));
  assert.equal(toCachedTail(rows).length, TRANSCRIPT_TAIL_MAX);
  const clipped = toCachedTail([{ id: 'x', role: 'assistant', text: 'z'.repeat(9000) }]);
  assert.ok(clipped[0].text.length <= 4000);
});

test('save then load round-trips the tail', async () => {
  stubStorage();
  await saveTranscriptTail('scope', 'default', 's1', [
    { id: 'a', role: 'user', text: 'hello', rowId: 3, ts: 42 },
    { id: 'b', role: 'assistant', text: 'world', rowId: 4 },
  ]);
  const loaded = await loadTranscriptTail('scope', 'default', 's1');
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0].text, 'hello');
  assert.equal(loaded[0].rowId, 3);
  assert.equal(loaded[1].text, 'world');
  // A different session sees nothing.
  assert.deepEqual(await loadTranscriptTail('scope', 'default', 's9'), []);
});

test('corrupt payloads read as empty, never throw', async () => {
  const { map } = stubStorage();
  const { transcriptTailKey: keyFn } = await import('./transcript-cache.ts');
  map.set(keyFn('s', 'default', 's1'), '{not json');
  assert.deepEqual(await loadTranscriptTail('s', 'default', 's1'), []);
});
