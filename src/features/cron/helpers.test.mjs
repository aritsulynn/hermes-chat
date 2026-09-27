import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LOCAL_DELIVERY,
  deliveryOptions,
  getScheduleExpr,
  normaliseDelivery,
  parseMessageContent,
  scopedRunKey,
} from './helpers.ts';

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

const TARGETS = [
  { id: 'telegram', name: 'Telegram', home_target_set: true, home_env_var: null },
  { id: 'discord', name: 'Discord', home_target_set: false, home_env_var: 'DISCORD_HOME_CHANNEL' },
];

test('deliveryOptions always offers local first and gates origin on a known origin', () => {
  const withOrigin = deliveryOptions(TARGETS, { hasOrigin: true }).map((o) => o.id);
  assert.deepEqual(withOrigin, ['local', 'origin', 'telegram', 'discord']);

  // A brand-new job has nowhere to send "back to", so the option is withheld
  // rather than offered and silently falling back to a home channel.
  const withoutOrigin = deliveryOptions(TARGETS).map((o) => o.id);
  assert.deepEqual(withoutOrigin, ['local', 'telegram', 'discord']);

  // Fetch failed / gateway reports nothing: local is the one option that always
  // works, and the caller keys its "no targets" message off that length.
  assert.deepEqual(deliveryOptions([]).map((o) => o.id), ['local']);
});

test('normaliseDelivery keeps a known target, opens a broadcast on its first entry', () => {
  const options = deliveryOptions(TARGETS, { hasOrigin: true });
  assert.equal(normaliseDelivery('telegram', options), 'telegram');
  assert.equal(normaliseDelivery('origin', options), 'origin');
  // A job with no delivery set is the server's `local` default.
  assert.equal(normaliseDelivery('', options), LOCAL_DELIVERY);
  assert.equal(normaliseDelivery(null, options), LOCAL_DELIVERY);
  // Broadcast to several targets: the form edits one at a time.
  assert.equal(normaliseDelivery('telegram,discord', options), 'telegram');
});

test('normaliseDelivery falls back to local for a target this gateway no longer offers', () => {
  const options = deliveryOptions(TARGETS, { hasOrigin: true });
  // E.g. a platform that has since been disconnected. Opening on `local` is the
  // only offered option that cannot drop the user's delivery on the next save.
  assert.equal(normaliseDelivery('slack', options), LOCAL_DELIVERY);
  // Same when the gateway reported no targets at all — `local` is always present.
  assert.equal(normaliseDelivery('slack', deliveryOptions([])), LOCAL_DELIVERY);
});
