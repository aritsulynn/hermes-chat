import assert from 'node:assert/strict';
import test from 'node:test';

import { cleanThinking, flattenLists, renderMediaTags } from './messages.ts';

// These three are the preprocessing the chat markdown path depends on: every
// assistant reply is `cleanThinking`-free markdown that has been through
// `flattenLists` and `renderMediaTags` before react-markdown ever sees it. They
// are pure, so they are testable here even though the renderer itself is not —
// see the note in AGENTS.md about there being no JSX in the test harness.
//
// This file replaces markdown-compat.test.mjs, which asserted that the
// `markdown-it` devDependency still turned `[x](mailto:…)` into an href. That
// was a smoke test of a package, not of this app, and the renderer changed
// underneath it: the port moved from react-native-markdown-display (which used
// markdown-it internally) to react-markdown + remark-gfm. markdown-it is now
// referenced by nothing.

test('cleanThinking drops the model\'s "status line" preamble', () => {
  assert.equal(
    cleanThinking('(thinking) Considering the options...\nThe actual answer is here.'),
    'The actual answer is here.',
  );
});

test('cleanThinking keeps a first line that is not a trailing ellipsis', () => {
  // The preamble pattern requires the line to END in `...`. A reply whose
  // opening sentence legitimately ends that way is content, not status, and
  // deleting it would silently drop the first line of the answer.
  assert.equal(cleanThinking('Loading the file...\nSecond line.'), 'Loading the file...\nSecond line.');
  assert.equal(cleanThinking('One line only...'), 'One line only...');
});

test('cleanThinking keeps one blank separator and collapses the rest', () => {
  // Streaming deltas arrive separated by blank lines. A tall run of them renders
  // as an empty void, but paragraph breaks are real and must survive — so the
  // rule is "at most one", not "none".
  assert.equal(cleanThinking('a\n\n\n\nb'), 'a\n\nb');
  assert.equal(cleanThinking('a\n\nb\n\nc'), 'a\n\nb\n\nc');
});

test('cleanThinking treats zero-width lines as blank', () => {
  // `\s` does not match these, which is exactly why they were padding out the
  // thinking bubble before.
  assert.equal(cleanThinking('a\n\n⁠\nb'), 'a\n\nb');
});

test('cleanThinking trims trailing invisibles off the end', () => {
  assert.equal(cleanThinking('done\n\n  '), 'done');
});

test('flattenLists rewrites bullets without flattening the nesting', () => {
  // Indentation is capped at 3 characters so a deeply nested list still reads as
  // nested; the content is untouched.
  assert.equal(flattenLists('- one'), '• one');
  assert.equal(flattenLists('* two'), '• two');
  assert.equal(flattenLists('+ three'), '• three');
  assert.equal(flattenLists('  - nested'), '  • nested');
  assert.equal(flattenLists('- a\n- b'), '• a\n• b');
});

test('flattenLists turns task-list markers into plain bullets', () => {
  // The agent emits `- [ ]` / `- [x]`; react-markdown only makes those a
  // checkbox under GFM, and the bubble renders them as bullets, so the marker
  // has to go or the bubble shows a literal `[ ]`.
  assert.equal(flattenLists('- [ ] todo'), '• todo');
  assert.equal(flattenLists('- [x] done'), '• done');
  assert.equal(flattenLists('- [X] shout'), '• shout');
});

test('flattenLists escapes the ordered-list dot so it stays a paragraph', () => {
  // An unescaped `1. ` at the start of a line is parsed as a list, which would
  // re-indent the line inside a <p> and shift the bubble's layout.
  assert.equal(flattenLists('1. first'), '1\\. first');
  assert.equal(flattenLists('2) second'), '2\\. second');
  assert.equal(flattenLists('1. a\n2. b'), '1\\. a\n2\\. b');
});

test('flattenLists leaves non-list lines alone', () => {
  // The most important case: prose that merely contains a dash or a number must
  // not be rewritten, or ordinary sentences get mangled.
  assert.equal(flattenLists('a - b'), 'a - b');
  assert.equal(flattenLists('See 1. the docs'), 'See 1. the docs');
  assert.equal(flattenLists('-'), '-');
  assert.equal(flattenLists(''), '');
});

test('renderMediaTags turns a MEDIA: tag into a file link', () => {
  // MEDIA: is the agent's attachment contract; it has to become a link for the
  // markdown `a` renderer, which renders anything non-http as a FileChip.
  // The href keeps the `media:` scheme so it round-trips back to a path, and the
  // label is prefixed so the chip does not read as a bare filename.
  const out = renderMediaTags('here it is\nMEDIA:out/report.pdf');
  assert.match(out, /\[File: report\.pdf\]\(#media:out%2Freport\.pdf\)/);
  assert.doesNotMatch(out, /MEDIA:out/);
});

test('renderMediaTags leaves a tagged example inside a code fence alone', () => {
  // A documented example must stay literal, or the docs render an image.
  const out = renderMediaTags('```\nMEDIA:out/report.pdf\n```');
  assert.match(out, /MEDIA:out\/report\.pdf/);
  assert.doesNotMatch(out, /\[report\.pdf\]/);
});

test('renderMediaTags leaves a tagged example inside an inline span alone', () => {
  const out = renderMediaTags('use `MEDIA:out/x.png` for attachments');
  assert.doesNotMatch(out, /\[x\.png\]/);
});

test('renderMediaTags does not touch text with no tag', () => {
  const text = 'plain reply\nwith two lines';
  assert.equal(renderMediaTags(text), text);
  assert.equal(renderMediaTags(''), '');
});
