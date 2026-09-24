import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlashCompletion, parseClarify } from './messages.ts';

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
