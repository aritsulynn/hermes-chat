import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compactNumber,
  formatBytes,
  formatCost,
  formatDayLabel,
  formatRelative,
  formatRunDuration,
  formatSessionSource,
  toEpochMs,
} from './format.ts';

test('compactNumber formats k/M rungs and floors non-positive values', () => {
  assert.equal(compactNumber(999), '999');
  assert.equal(compactNumber(1000), '1k');
  assert.equal(compactNumber(1230), '1.2k');
  assert.equal(compactNumber(1_500_000), '1.5M');
  assert.equal(compactNumber(0), '0');
  assert.equal(compactNumber(null), '0');
  assert.equal(compactNumber(-5), '0');
});

test('formatBytes renders binary units and dashes for missing values', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(null), '-');
  assert.equal(formatBytes(undefined), '-');
});

test('formatCost shows cents, a floor label, and the zero default', () => {
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(null), '$0.00');
  assert.equal(formatCost(0.005), '<$0.01');
  assert.equal(formatCost(0.01), '$0.01');
  assert.equal(formatCost(1.5), '$1.50');
});

test('toEpochMs normalizes seconds, millis, numeric strings and ISO strings', () => {
  assert.equal(toEpochMs(null), null);
  assert.equal(toEpochMs(''), null);
  assert.equal(toEpochMs(1_700_000_000), 1_700_000_000_000);
  assert.equal(toEpochMs(1_700_000_000_000), 1_700_000_000_000);
  assert.equal(toEpochMs('1700000000'), 1_700_000_000_000);
  assert.equal(toEpochMs('2026-09-26T00:00:00Z'), Date.parse('2026-09-26T00:00:00Z'));
});

test('formatRunDuration renders s / m / m s and rejects bad ranges', () => {
  assert.equal(formatRunDuration(1000, 1012), '12s');
  assert.equal(formatRunDuration(1000, 1180), '3m');
  assert.equal(formatRunDuration(1000, 1200), '3m 20s');
  assert.equal(formatRunDuration(2000, 1000), null);
  assert.equal(formatRunDuration(1000, null), null);
  assert.equal(formatRunDuration(0, 1000), null);
});

test('formatRelative counts up in m / h / d and clamps the last minute to now', () => {
  const now = 1_700_000_000_000;
  const ago = (seconds) => now / 1000 - seconds;
  assert.equal(formatRelative(ago(0), now), 'now');
  assert.equal(formatRelative(ago(59), now), 'now');
  assert.equal(formatRelative(ago(60), now), '1m');
  assert.equal(formatRelative(ago(60 * 59), now), '59m');
  assert.equal(formatRelative(ago(3600), now), '1h');
  assert.equal(formatRelative(ago(3600 * 23), now), '23h');
  assert.equal(formatRelative(ago(86400), now), '1d');
  assert.equal(formatRelative(ago(86400 * 6), now), '6d');
});

test('formatRelative accepts millis, blanks unusable values and dates a week-old stamp', () => {
  const now = 1_700_000_000_000;
  assert.equal(formatRelative(now - 120_000, now), '2m');
  // Clock skew / a stamp ahead of us reads as "now", never as a negative age.
  assert.equal(formatRelative(now / 1000 + 600, now), 'now');
  assert.equal(formatRelative(null, now), '');
  assert.equal(formatRelative(undefined, now), '');
  assert.equal(formatRelative(0, now), '');
  assert.match(formatRelative(now / 1000 - 86400 * 30, now), /\w{3} \d{1,2}/);
});

test('formatSessionSource tags the automated sources and nothing else', () => {
  // Rows a human opened in some client: the uninteresting default, no badge.
  assert.equal(formatSessionSource('tui'), null);
  assert.equal(formatSessionSource('desktop'), null);
  assert.equal(formatSessionSource('local'), null);
  assert.equal(formatSessionSource(''), null);
  assert.equal(formatSessionSource(null), null);
  // Rows nobody typed into the app — worth knowing about at a glance.
  assert.equal(formatSessionSource('cron'), 'Cron');
  assert.equal(formatSessionSource('telegram'), 'Telegram');
  assert.equal(formatSessionSource('api'), 'API');
  assert.equal(formatSessionSource('bot_room'), 'Room');
  assert.equal(formatSessionSource('unknown'), 'Unknown');
  // Case/space tolerant, and an unrecognised value degrades to no badge rather
  // than printing a raw server token at the user.
  assert.equal(formatSessionSource('  CRON '), 'Cron');
  assert.equal(formatSessionSource('something_new'), null);
});

test('formatDayLabel shortens ISO days and passes others through', () => {
  assert.equal(formatDayLabel('2026-09-26'), '26/09');
  assert.equal(formatDayLabel('nope'), 'nope');
});
