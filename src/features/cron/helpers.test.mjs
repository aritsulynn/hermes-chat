import assert from 'node:assert/strict';
import test from 'node:test';

import { getScheduleExpr, parseMessageContent, scopedRunKey } from './helpers.ts';

test('getScheduleExpr prefers display, then string, then expr', () => {
  assert.equal(getScheduleExpr({ id: '1', schedule_display: '@daily' }), '@daily');
  assert.equal(getScheduleExpr({ id: '1', schedule: '0 9 * * *' }), '0 9 * * *');
  assert.equal(getScheduleExpr({ id: '1', schedule: { expr: '0 1 * * *' } }), '0 1 * * *');
  assert.equal(getScheduleExpr({ id: '1' }), '');
});

test('parseMessageContent handles string/array/object/null', () => {
  assert.equal(parseMessageContent('hi'), 'hi');
  assert.equal(parseMessageContent([{ text: 'a' }, 'b']), 'a\nb');
  assert.equal(parseMessageContent({ text: 'c' }), 'c');
  assert.equal(parseMessageContent(null), '');
});

test('scopedRunKey namespaces the run id by profile', () => {
  assert.equal(scopedRunKey('r1'), JSON.stringify(['', 'r1']));
  assert.equal(scopedRunKey('r1', 'dev'), JSON.stringify(['dev', 'r1']));
});
