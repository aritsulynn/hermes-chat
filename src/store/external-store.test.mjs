import assert from 'node:assert/strict';
import test from 'node:test';

import { appStore, createExternalStore, createSelectionReader } from './external-store.ts';

const message = (id) => ({ id, text: id });

// A stand-in for the AppContext value: the mirror only ever hands the whole
// object to a selector, so the shape beyond these slices does not matter.
const state = (overrides = {}) => ({
  sessionId: 's1',
  model: 'gpt-5',
  generating: false,
  messages: [message('m1')],
  todos: [],
  ...overrides,
});

// Mirrors what react-dom does with a useSyncExternalStore subscription: on
// every store notification it re-reads the snapshot and only re-renders when
// the reference actually changed (that reference check is the whole reason the
// selector result has to be memoized). `renders` therefore counts the renders
// a component using this reader would take.
function reactSubscription(store, getSelection) {
  const seen = { value: getSelection(), renders: 1 };
  const sync = () => {
    const next = getSelection();
    if (Object.is(next, seen.value)) return false;
    seen.value = next;
    seen.renders += 1;
    return true;
  };
  return { seen, commit: sync, unsubscribe: store.subscribe(sync) };
}

test('write publishes without notifying, flush notifies subscribers', () => {
  const store = createExternalStore();
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });

  store.write(state());
  assert.equal(notified, 0, 'write runs in the render phase and must stay silent');
  assert.equal(store.getSnapshot().sessionId, 's1');

  store.flush();
  assert.equal(notified, 1);
});

test('a flush with no write in between notifies nobody', () => {
  const store = createExternalStore();
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });

  store.write(state());
  store.flush();
  store.flush();
  store.flush();
  assert.equal(notified, 1);
});

test('rewriting the same value is not a change', () => {
  const store = createExternalStore();
  const value = state();
  store.write(value);
  store.flush();

  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  store.write(value);
  store.flush();
  assert.equal(notified, 0);
});

test('unsubscribed listeners stop being notified', () => {
  const store = createExternalStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => {
    notified += 1;
  });

  store.write(state());
  store.flush();
  unsubscribe();
  store.write(state({ sessionId: 's2' }));
  store.flush();
  assert.equal(notified, 1);
});

test('a slice selector keeps its reference when unrelated state changes', () => {
  const store = createExternalStore();
  const messages = state().messages;
  store.write(state({ messages }));

  const select = createSelectionReader(store, (s) => s.messages);
  const sub = reactSubscription(store, select);
  assert.equal(sub.seen.value, messages);

  // Four unrelated updates (typing, a session switch, a live-roster tick...).
  store.write(state({ messages, model: 'claude', input: 'hi' }));
  store.flush();
  store.write(state({ messages, sessionId: 's2' }));
  store.flush();
  store.write(state({ messages, generating: true }));
  store.flush();

  assert.equal(sub.seen.renders, 1, 'no re-render for a slice that did not change');
  assert.equal(sub.seen.value, messages);
  sub.unsubscribe();
});

test('a slice selector updates when its own slice changes', () => {
  const store = createExternalStore();
  store.write(state());

  const select = createSelectionReader(store, (s) => s.messages);
  const sub = reactSubscription(store, select);
  assert.equal(sub.seen.renders, 1);

  const grown = [...state().messages, message('m2')];
  store.write(state({ messages: grown }));
  store.flush();

  assert.equal(sub.seen.renders, 2);
  assert.equal(sub.seen.value, grown);
  sub.unsubscribe();
});

test('repeated reads of one snapshot return one reference', () => {
  const store = createExternalStore();
  store.write(state());
  const select = createSelectionReader(store, (s) => s.messages);

  const first = select();
  assert.equal(select(), first);
  assert.equal(select(), first, 'a stable getSnapshot is what stops useSyncExternalStore looping');
});

test('a custom isEqual keeps the old reference for an equal slice', () => {
  const store = createExternalStore();
  store.write(state());

  // Allocating selector: a new object every read, so identity alone would
  // report a change on every notification and React would re-render forever.
  // isEqual below only cares about the message ids, so `generating` changing
  // counts as equal here — the caller's isEqual is what decides.
  const select = createSelectionReader(
    store,
    (s) => ({ ids: s.messages.map((m) => m.id), generating: s.generating }),
    (a, b) => a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]),
  );
  const sub = reactSubscription(store, select);
  const first = sub.seen.value;
  assert.equal(sub.seen.renders, 1);

  store.write(state({ model: 'claude' }));
  store.flush();
  assert.equal(sub.seen.renders, 1, 'unrelated change, equal selection');
  assert.equal(sub.seen.value, first, 'the caller keeps the reference it rendered with');

  store.write(state({ generating: true }));
  store.flush();
  assert.equal(sub.seen.renders, 1, 'changed outside isEqual, so no re-render');
  assert.equal(sub.seen.value, first);

  store.write(state({ messages: [message('m1'), message('m2')] }));
  store.flush();
  assert.equal(sub.seen.renders, 2, 'a real change slips through isEqual');
  assert.deepEqual(sub.seen.value.ids, ['m1', 'm2']);
  sub.unsubscribe();
});

test('the shared app store reads back what the provider published', () => {
  appStore.write(state({ sessionId: 'published' }));
  appStore.flush();
  assert.equal(createSelectionReader(appStore, (s) => s.sessionId)(), 'published');
});

test('reading before the provider published anything throws', () => {
  const store = createExternalStore();
  const select = createSelectionReader(store, (s) => s.sessionId);
  assert.throws(() => select(), /useAppSelector must be used inside AppProvider/);
});
