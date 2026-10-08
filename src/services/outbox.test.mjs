import assert from 'node:assert/strict';
import test from 'node:test';

import { clearOutbox, loadOutbox, loadOwnerQueue, outboxKey, saveOwnerState } from './outbox.ts';

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

test('outbox keys are scoped per account', () => {
  assert.notEqual(outboxKey('h@alice'), outboxKey('h@bob'));
});

test('save then load round-trips drafts and per-room queues', async () => {
  stubStorage();
  await saveOwnerState('scope', 'owner-A', new Map([['owner-A', 'half-typed…']]), [
    { id: 'q1', text: 'first' },
    { id: 'q2', text: 'second' },
  ]);
  const doc = await loadOutbox('scope');
  assert.deepEqual(doc.drafts, [['owner-A', 'half-typed…']]);
  assert.equal((await loadOwnerQueue('scope', 'owner-A')).length, 2);
  assert.deepEqual(await loadOwnerQueue('scope', 'owner-B'), []);
});

test('saving another room preserves existing queues', async () => {
  stubStorage();
  await saveOwnerState('scope', 'owner-A', new Map(), [{ id: 'q1', text: 'keep me' }]);
  await saveOwnerState('scope', 'owner-B', new Map([['owner-B', 'draft']]), []);
  assert.equal((await loadOwnerQueue('scope', 'owner-A')).length, 1);
  assert.deepEqual((await loadOutbox('scope')).drafts, [['owner-B', 'draft']]);
});

test('empty text is not persisted and empty queues are pruned', async () => {
  stubStorage();
  await saveOwnerState('scope', 'owner-A', new Map([['owner-A', '   ']]), []);
  const doc = await loadOutbox('scope');
  assert.deepEqual(doc.drafts, []);
  assert.deepEqual(doc.queues, {});
});

test('queues are capped oldest-first', async () => {
  stubStorage();
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `q${i}`, text: `t${i}` }));
  await saveOwnerState('scope', 'owner-A', new Map(), many);
  const loaded = await loadOwnerQueue('scope', 'owner-A');
  assert.equal(loaded.length, 20);
  assert.equal(loaded[0].text, 't10');
});

test('corrupt payloads read as empty and clear drops the doc', async () => {
  const { map } = stubStorage();
  map.set(outboxKey('scope'), '{not json');
  assert.deepEqual(await loadOutbox('scope'), { drafts: [], queues: {} });
  await saveOwnerState('scope', 'owner-A', new Map([['k', 'v']]), []);
  await clearOutbox('scope');
  assert.deepEqual(await loadOutbox('scope'), { drafts: [], queues: {} });
});
