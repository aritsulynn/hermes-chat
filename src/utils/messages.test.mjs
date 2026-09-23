import assert from 'node:assert/strict';
import test from 'node:test';

import { applySlashCompletion } from './messages.ts';

test('keeps the slash when the gateway returns a bare command name', () => {
  assert.equal(applySlashCompletion('/g', 'goal', 0), '/goal ');
});

test('does not duplicate a slash already present in a completion', () => {
  assert.equal(applySlashCompletion('/he', '/help ', 0), '/help ');
});

test('does not prefix slash argument completions', () => {
  assert.equal(applySlashCompletion('/model son', 'sonnet', 7), '/model sonnet ');
});
