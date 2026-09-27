// Hook-level coverage for the store mirror. The render-skipping proof lives in
// external-store.test.mjs (a useSyncExternalStore subscription re-reads the
// snapshot and bails out when the reference is unchanged); this file pins the
// wiring — that the hook reads the store the provider published — through a
// real React render (react-dom/server needs no DOM and runs the hooks for real).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { appStore } from './external-store.ts';
import { useAppSelector } from './useAppSelector.ts';

const state = (overrides = {}) => ({
  sessionId: 's1',
  model: 'gpt-5',
  generating: false,
  messages: [{ id: 'm1' }],
  ...overrides,
});

const publish = (next) => {
  appStore.write(state(next));
  appStore.flush();
};

test('useAppSelector renders the slice the provider published', () => {
  publish({ sessionId: 'abc', generating: true });

  function Header() {
    const sessionId = useAppSelector((s) => s.sessionId);
    const generating = useAppSelector((s) => s.generating);
    return createElement('p', null, `${sessionId}:${generating}`);
  }

  assert.equal(renderToStaticMarkup(createElement(Header)), '<p>abc:true</p>');
});

test('the hook returns the store reference unchanged for an untouched slice', () => {
  const messages = state().messages;
  publish({ messages });
  const seen = [];

  function Transcript() {
    const rows = useAppSelector((s) => s.messages);
    seen.push(rows);
    return createElement('p', null, String(rows.length));
  }

  assert.equal(renderToStaticMarkup(createElement(Transcript)), '<p>1</p>');
  publish({ messages, model: 'claude', generating: true });
  assert.equal(renderToStaticMarkup(createElement(Transcript)), '<p>1</p>');
  assert.equal(seen[1], seen[0], 'no new identity for a slice that did not change');

  const grown = [...messages, { id: 'm2' }];
  publish({ messages: grown });
  assert.equal(renderToStaticMarkup(createElement(Transcript)), '<p>2</p>');
  assert.equal(seen[2], grown);
});

test('an allocating selector renders through a custom isEqual', () => {
  publish({ sessionId: 's1' });

  function Title() {
    const { id, model } = useAppSelector(
      (s) => ({ id: s.sessionId, model: s.model }),
      (a, b) => a.id === b.id && a.model === b.model,
    );
    return createElement('p', null, `${id}/${model}`);
  }

  // A new object on every read: without isEqual the reference would differ on
  // every check and React would keep re-rendering (the reuse itself is pinned
  // in external-store.test.mjs, where a live subscription can re-read a
  // snapshot — a server render starts from a cold cache by design).
  assert.equal(renderToStaticMarkup(createElement(Title)), '<p>s1/gpt-5</p>');
  publish({ generating: true });
  assert.equal(renderToStaticMarkup(createElement(Title)), '<p>s1/gpt-5</p>');

  publish({ model: 'claude' });
  assert.equal(renderToStaticMarkup(createElement(Title)), '<p>s1/claude</p>');
});
