import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FAILED_TURN_NOTICE,
  PARTIAL_FAILED_TURN_NOTICE,
  applySlashCompletion,
  parseClarify,
  sliceOlderThan,
  stripFailedTurnNotice,
} from './messages.ts';

test('strips the failed-turn boundary copy the gateway appends', () => {
  // A Stop lands here: the gateway appends its own copy to message.complete,
  // and "send it again" is wrong advice for a deliberate cancellation.
  assert.equal(stripFailedTurnNotice(FAILED_TURN_NOTICE), '');
  assert.equal(stripFailedTurnNotice(PARTIAL_FAILED_TURN_NOTICE), '');
  // Trailing whitespace/newlines from the append must not defeat the match.
  assert.equal(stripFailedTurnNotice(`${FAILED_TURN_NOTICE}\n\n`), '');
  // Real reply text before the boundary survives — only the notice is removed.
  assert.equal(
    stripFailedTurnNotice(`Here is what I found.\n\n${FAILED_TURN_NOTICE}`),
    'Here is what I found.',
  );
  // Both notices in one payload: the append only ever adds one, but stripping
  // must not loop or leave the first behind.
  assert.equal(stripFailedTurnNotice(`${PARTIAL_FAILED_TURN_NOTICE}\n\n${FAILED_TURN_NOTICE}`), '');
});

test('leaves a real reply that merely quotes the notice intact', () => {
  const quoted = `You wrote "${FAILED_TURN_NOTICE}" — that is the copy I would emit.`;
  assert.equal(stripFailedTurnNotice(quoted), quoted);
  // Not a boundary row (no trailing copy) → untouched.
  assert.equal(stripFailedTurnNotice('A normal answer.'), 'A normal answer.');
  assert.equal(stripFailedTurnNotice(''), '');
});

test('keeps the slash when the gateway returns a bare command name', () => {
  assert.equal(applySlashCompletion('/g', 'goal', 0), '/goal ');
});

test('does not duplicate a slash already present in a completion', () => {
  assert.equal(applySlashCompletion('/he', '/help ', 0), '/help ');
});

test('does not prefix slash argument completions', () => {
  assert.equal(applySlashCompletion('/model son', 'sonnet', 7), '/model sonnet ');
});

test('restores locked clarify answers from a reconnect payload', () => {
  const parsed = parseClarify({
    params: {
      questions: [
        { qid: 'q1', question: 'One?', choices: ['a', 'b'] },
        { qid: 'q2', question: 'Two?', choices: ['c', 'd'] },
      ],
      answers: { q1: 'a' },
    },
  });

  assert.equal(parsed.single, false);
  assert.equal(parsed.questions[0].lockedAnswer, 'a');
  assert.equal(parsed.questions[1].lockedAnswer, undefined);
});

const bubble = (role, text, rowId) => ({
  id: `${role}-${rowId ?? text}`,
  role,
  text,
  ...(rowId != null ? { rowId } : {}),
});

test('sliceOlderThan prepends only rows before the anchor', () => {
  const fetched = [bubble('user', 'one', 1), bubble('assistant', 'two', 2), bubble('user', 'three', 3)];
  const current = [bubble('assistant', 'two', 2), bubble('user', 'three', 3)];
  const head = sliceOlderThan(fetched, current);
  assert.equal(head.length, 1);
  assert.equal(head[0].rowId, 1);
});

test('sliceOlderThan returns [] when the anchor is the oldest fetched row', () => {
  const fetched = [bubble('user', 'one', 1)];
  const current = [bubble('user', 'one', 1)];
  assert.deepEqual(sliceOlderThan(fetched, current), []);
});

test('sliceOlderThan returns the whole fetch for an empty window', () => {
  const fetched = [bubble('user', 'one', 1)];
  assert.deepEqual(sliceOlderThan(fetched, []), fetched);
});

test('sliceOlderThan aborts when the anchor is gone (rewritten history)', () => {
  const fetched = [bubble('user', 'new', 9)];
  const current = [bubble('user', 'old', 1)];
  assert.deepEqual(sliceOlderThan(fetched, current), []);
});

test('sliceOlderThan skips non-durable bubbles to find the anchor', () => {
  const fetched = [
    bubble('user', 'one', 1),
    { id: 't1', role: 'thinking', text: 'hmm' },
    bubble('user', 'two', 2),
  ];
  const current = [{ id: 't9', role: 'thinking', text: 'hmm' }, bubble('user', 'two', 2)];
  const head = sliceOlderThan(fetched, current);
  assert.equal(head.length, 2);
  assert.equal(head[1].role, 'thinking');
});
