import assert from 'node:assert/strict';
import test from 'node:test';

import {
  pairThinkingText,
  missingHistoryTools,
  FAILED_TURN_NOTICE,
  PARTIAL_FAILED_TURN_NOTICE,
  applySlashCompletion,
  parseClarify,
  sliceOlderThan,
  splitSettled,
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
  assert.equal(stripFailedTurnNotice(`Here is what I found.\n\n${FAILED_TURN_NOTICE}`), 'Here is what I found.');
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
  const fetched = [bubble('user', 'one', 1), { id: 't1', role: 'thinking', text: 'hmm' }, bubble('user', 'two', 2)];
  const current = [{ id: 't9', role: 'thinking', text: 'hmm' }, bubble('user', 'two', 2)];
  const head = sliceOlderThan(fetched, current);
  assert.equal(head.length, 2);
  assert.equal(head[1].role, 'thinking');
});

test('missingHistoryTools returns only trailing history tool rows without a live bubble', () => {
  const tool = (id, text) => ({ id, role: 'tool', text });
  const user = (id) => ({ id, role: 'user', text: 'hi' });
  const ai = (id) => ({ id, role: 'assistant', text: 'done' });
  // Steady state: every history tool has a live bubble → nothing to insert.
  assert.deepEqual(
    missingHistoryTools([user('u'), tool('h1', 'terminal'), ai('a')], [user('u'), tool('l1', 'terminal'), ai('a')]),
    [],
  );
  // A new turn appended a second terminal call server-side; live lacks it.
  const missing = missingHistoryTools(
    [user('u'), tool('h1', 'terminal'), ai('a'), user('u2'), tool('h2', 'terminal'), ai('a2')],
    [user('u'), tool('l1', 'terminal'), ai('a'), user('u2'), ai('a2')],
  );
  assert.deepEqual(
    missing.map((m) => m.id),
    ['h2'],
  );
  // Leading unpaired history rows (trimmed window) are old — never re-inserted.
  assert.deepEqual(missingHistoryTools([tool('h0', 'old'), tool('h1', 'terminal')], [tool('l1', 'terminal')]), []);
  // No pairs at all (nothing live to anchor against) → insert nothing…
  assert.deepEqual(missingHistoryTools([tool('h1', 'terminal')], []), []);
  // …unless the window is intact (fresh room, nothing trimmed/paged):
  // then every history tool is genuinely missing.
  assert.deepEqual(
    missingHistoryTools([tool('h1', 'terminal')], [], true).map((m) => m.id),
    ['h1'],
  );
  assert.deepEqual(
    missingHistoryTools(
      Array.from({ length: 25 }, (_, i) => tool(`h${i}`, 't')),
      [],
      true,
    ),
    [],
  );
  // A surplus beyond the cap is structural mismatch, not a turn → skip.
  const many = Array.from({ length: 25 }, (_, i) => tool(`h${i}`, 'terminal'));
  assert.deepEqual(missingHistoryTools([...many, tool('base', 'other')], [tool('l0', 'other')]), []);
});

test('missingHistoryTools tolerates label differences via positional fallback', () => {
  const tool = (id, text) => ({ id, role: 'tool', text });
  // Event bubble labelled `tool`, history row `Tool` — same slot, no insert.
  assert.deepEqual(missingHistoryTools([tool('h1', 'Tool')], [tool('l1', 'tool')]), []);
  // Extra live bubble (history lag) consumes positionally — no phantom insert.
  assert.deepEqual(missingHistoryTools([tool('h1', 'terminal')], [tool('l1', 'terminal'), tool('l2', 'patch')]), []);
});

test('pairThinkingText settles live fragments to the persisted reasoning', () => {
  const think = (id, text) => ({ id, role: 'thinking', text });
  // Same single pair, different text → overwrite with the history version.
  assert.deepEqual(
    pairThinkingText([think('h', 'The user asks to run echo.')], [think('l', '(▲) tracking ember fall…')]),
    [{ id: 'l', text: 'The user asks to run echo.' }],
  );
  // Already settled → no-op.
  assert.deepEqual(pairThinkingText([think('h', 'Same')], [think('l', 'Same')]), []);
  // A turn without a reasoning sidecar keeps its fragments (pairs from the end).
  assert.deepEqual(
    pairThinkingText([think('h1', 'First reasoning')], [think('l1', 'fragments…'), think('l2', 'First reasoning')]),
    [],
  );
  // Empty history text never clobbers.
  assert.deepEqual(pairThinkingText([think('h', '   ')], [think('l', 'fragments…')]), []);
});

test('splitSettled splits a streaming body at the last blank line', () => {
  // Nothing settled yet: a first block still being written has no boundary.
  assert.deepEqual(splitSettled('one line so far'), ['', 'one line so far']);
  assert.deepEqual(splitSettled(''), ['', '']);
  // A completed paragraph is settled; the next one is not.
  assert.deepEqual(splitSettled('first\n\nsecond'), ['first\n\n', 'second']);
  assert.deepEqual(splitSettled('first\n\nsecond\n\nthird'), ['first\n\nsecond\n\n', 'third']);
  // The boundary is the blank line, so a trailing blank line settles everything.
  assert.deepEqual(splitSettled('done\n\n'), ['done\n\n', '']);
});

test('splitSettled does not split inside a code fence', () => {
  assert.deepEqual(splitSettled('```ts\nlet a = 1;\n\nlet b = 2;\n'), ['', '```ts\nlet a = 1;\n\nlet b = 2;\n']);
  // A fence that closes leaves the blank line after it as a real boundary.
  assert.deepEqual(splitSettled('```ts\nlet a = 1;\n```\n\ntail'), ['```ts\nlet a = 1;\n```\n\n', 'tail']);
  // Tilde fences too, and an unterminated fence swallows any later blank line.
  assert.deepEqual(splitSettled('~~~\ncode\n~~~\n\ntail'), ['~~~\ncode\n~~~\n\n', 'tail']);
  assert.deepEqual(splitSettled('a\n\n```\nopen\n\nstill code'), ['a\n\n', '```\nopen\n\nstill code']);
});
