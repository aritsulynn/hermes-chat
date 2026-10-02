import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildScheduleString,
  DEFAULT_SCHEDULE_STATE,
  describeSchedule,
  englishOrdinal,
  parseScheduleString,
} from './schedule.ts';

/** Assert only the fields a case cares about, mirroring vitest's toMatchObject. */
function pick(obj, keys) {
  const out = {};
  for (const key of keys) out[key] = obj[key];
  return out;
}

test('parseScheduleString parses recurring interval strings', () => {
  assert.deepEqual(pick(parseScheduleString('every 30m'), ['mode', 'intervalValue', 'intervalUnit']), {
    mode: 'interval',
    intervalValue: 30,
    intervalUnit: 'minutes',
  });
  assert.deepEqual(pick(parseScheduleString('every 2h'), ['mode', 'intervalValue', 'intervalUnit']), {
    mode: 'interval',
    intervalValue: 2,
    intervalUnit: 'hours',
  });
  assert.deepEqual(pick(parseScheduleString('every 1d'), ['mode', 'intervalValue', 'intervalUnit']), {
    mode: 'interval',
    intervalValue: 1,
    intervalUnit: 'days',
  });
});

test('parseScheduleString parses ISO timestamps into once mode', () => {
  assert.deepEqual(pick(parseScheduleString('2026-02-03T14:00:00'), ['mode', 'onceAt']), {
    mode: 'once',
    onceAt: '2026-02-03T14:00',
  });
  assert.deepEqual(pick(parseScheduleString('2026-02-03T14:00'), ['mode', 'onceAt']), {
    mode: 'once',
    onceAt: '2026-02-03T14:00',
  });
});

test('parseScheduleString parses daily, weekly and monthly cron', () => {
  assert.deepEqual(pick(parseScheduleString('0 9 * * *'), ['mode', 'timeOfDay']), {
    mode: 'daily',
    timeOfDay: '09:00',
  });
  assert.deepEqual(pick(parseScheduleString('30 14 * * 1,3,5'), ['mode', 'timeOfDay', 'weekdays']), {
    mode: 'weekly',
    timeOfDay: '14:30',
    weekdays: [1, 3, 5],
  });
  assert.deepEqual(pick(parseScheduleString('0 9 15 * *'), ['mode', 'timeOfDay', 'dayOfMonth']), {
    mode: 'monthly',
    timeOfDay: '09:00',
    dayOfMonth: 15,
  });
});

test('parseScheduleString normalizes cron Sunday 7 into the builder Sunday 0', () => {
  assert.deepEqual(pick(parseScheduleString('30 14 * * 1,7'), ['mode', 'timeOfDay', 'weekdays']), {
    mode: 'weekly',
    timeOfDay: '14:30',
    weekdays: [1, 0],
  });
});

test('parseScheduleString falls back to custom for unsupported strings', () => {
  for (const raw of [
    '0 9 * * 1-5',
    '@daily',
    '2026-02-03T14:00:00Z',
    '2026-02-03T14:00:00+08:00',
    '0 9 * * 1,8',
    '0 9 1,15 * *',
  ]) {
    assert.deepEqual(pick(parseScheduleString(raw), ['mode', 'custom']), {
      mode: 'custom',
      custom: raw,
    });
  }
});

test('parseScheduleString returns the default state for empty input', () => {
  assert.deepEqual(parseScheduleString(''), DEFAULT_SCHEDULE_STATE);
});

test('buildScheduleString round-trips parsed state', () => {
  const cases = [
    ['every 30m', 'every 30m'],
    ['every 2h', 'every 2h'],
    ['every 1d', 'every 1d'],
    ['0 9 * * *', '0 9 * * *'],
    ['30 14 * * 1,3,5', '30 14 * * 1,3,5'],
    ['30 14 * * 1,7', '30 14 * * 0,1'],
    ['0 9 15 * *', '0 9 15 * *'],
    ['0 9 1,15 * *', '0 9 1,15 * *'],
    ['2026-02-03T14:00:00', '2026-02-03T14:00:00'],
    ['2026-02-03T14:00', '2026-02-03T14:00:00'],
    ['2026-02-03T14:00:00Z', '2026-02-03T14:00:00Z'],
    ['2026-02-03T14:00:00+08:00', '2026-02-03T14:00:00+08:00'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(buildScheduleString(parseScheduleString(input)), expected);
  }
});

test('buildScheduleString returns empty for incomplete interval state', () => {
  assert.equal(buildScheduleString({ ...DEFAULT_SCHEDULE_STATE, mode: 'interval', intervalValue: 0 }), '');
});

const STRINGS = {
  none: '(no schedule)',
  everyMinutes: 'Every {n} min',
  everyHours: 'Every {n} h',
  everyDays: 'Every {n} d',
  dailyAt: 'Daily at {time}',
  weeklyAt: 'Weekly on {days} at {time}',
  monthlyAt: 'Monthly on the {day} at {time}',
  onceAt: 'Once at {time}',
  weekdaysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ordinal: englishOrdinal,
};

test('describeSchedule humanizes simple cron expressions', () => {
  assert.equal(describeSchedule({ kind: 'cron', expr: '0 9 * * *' }, undefined, STRINGS), 'Daily at 09:00');
  assert.equal(
    describeSchedule({ kind: 'cron', expr: '30 14 * * 1,3,5' }, undefined, STRINGS),
    'Weekly on Mon, Wed, Fri at 14:30',
  );
  assert.equal(
    describeSchedule({ kind: 'cron', expr: '0 9 15 * *' }, undefined, STRINGS),
    'Monthly on the 15th at 09:00',
  );
});

test('describeSchedule falls back to the raw expression when it cannot humanize', () => {
  assert.equal(describeSchedule(undefined, '0 9 * * 1-5', STRINGS), '0 9 * * 1-5');
  assert.equal(describeSchedule(undefined, undefined, STRINGS), '(no schedule)');
});

test('englishOrdinal handles the 11-13 exception', () => {
  assert.equal(englishOrdinal(1), '1st');
  assert.equal(englishOrdinal(2), '2nd');
  assert.equal(englishOrdinal(3), '3rd');
  assert.equal(englishOrdinal(4), '4th');
  assert.equal(englishOrdinal(11), '11th');
  assert.equal(englishOrdinal(12), '12th');
  assert.equal(englishOrdinal(13), '13th');
  assert.equal(englishOrdinal(22), '22nd');
  assert.equal(englishOrdinal(23), '23rd');
});
