import assert from 'node:assert/strict';
import test from 'node:test';

import { asBoard, asBoardList, pickBoardSlug } from './helpers.ts';

// These used to live inline in the screen as `setState` setters, which is why
// they had no tests. They are the screen's `select` functions now, and they run
// on every cache read, so the malformed-payload paths are worth pinning.

test('asBoardList keeps well-formed rows and drops the rest', () => {
  const list = asBoardList({
    boards: [{ slug: 'main', name: 'Main', is_current: true, total: 3 }, null, 7, { slug: 'other' }],
  });
  // null and 7 are dropped rather than rendered as empty chips; the last row
  // survives because a board with only a slug is still navigable.
  assert.deepEqual(list, [{ slug: 'main', name: 'Main', is_current: true, total: 3 }, { slug: 'other' }]);
});

test('asBoardList survives a payload that is not a board list', () => {
  assert.deepEqual(asBoardList(null), []);
  assert.deepEqual(asBoardList({ boards: 'nope' }), []);
  assert.deepEqual(asBoardList({ boards: [] }), []);
});

test('asBoard maps columns and their tasks', () => {
  const board = asBoard({ columns: [{ name: 'todo', tasks: [{ id: 't1', title: 'x' }] }, { name: 'done' }] });
  assert.equal(board.columns.length, 2);
  assert.equal(board.columns[0].tasks[0].id, 't1');
  assert.equal(board.columns[1].tasks.length, 0);
});

test('asBoard tolerates a missing columns key', () => {
  assert.deepEqual(asBoard({}), { columns: [] });
  assert.deepEqual(asBoard(null), { columns: [] });
});

test('pickBoardSlug prefers the saved board, then the server current, then the first', () => {
  const list = [{ slug: 'a' }, { slug: 'b', is_current: true }];
  assert.equal(pickBoardSlug(list, 'a'), 'a');
  // A saved slug the server no longer serves must fall through, not open nothing.
  assert.equal(pickBoardSlug(list, 'gone'), 'b');
  assert.equal(pickBoardSlug(list, null), 'b');
  assert.equal(pickBoardSlug([{ slug: 'only' }], null), 'only');
  assert.equal(pickBoardSlug([], 'a'), '');
});
