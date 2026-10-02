// Human-readable schedule picker for the cron create/edit form.
//
// Ported from Hermes Desktop `web/src/components/ScheduleBuilder.tsx`; the
// pure logic lives in `src/utils/schedule.ts`. The picker emits a single
// backend-compatible schedule string (see `cron/jobs.py::parse_schedule`), but
// the user fills shape-appropriate inputs per mode instead of typing cron.
//
// Fully controlled: the parent owns `ScheduleBuilderState` and derives the
// schedule string with `buildScheduleString`. Mode-specific slots are preserved
// across mode switches, so flipping back to a previous mode keeps the work.
import { useCallback } from 'react';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Button } from '../../../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  buildScheduleString,
  WEEKDAY_INDEXES,
  type IntervalUnit,
  type ScheduleBuilderState,
  type ScheduleMode,
  type Weekday,
} from '../../../utils/schedule';

const MODES: { value: ScheduleMode; label: string }[] = [
  { value: 'interval', label: 'Every…' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'once', label: 'Once' },
  { value: 'custom', label: 'Custom cron expression' },
];

const UNITS: { value: IntervalUnit; label: string }[] = [
  { value: 'minutes', label: 'minutes' },
  { value: 'hours', label: 'hours' },
  { value: 'days', label: 'days' },
];

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const FIELD_CLASS =
  'rounded-xl border border-border px-3.5 py-2.5 text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100';
const LABEL_CLASS = 'text-xs font-semibold text-neutral-700 dark:text-neutral-300';

export function ScheduleBuilder({
  value,
  onChange,
}: {
  value: ScheduleBuilderState;
  onChange: (state: ScheduleBuilderState) => void;
}) {
  const update = useCallback(
    (patch: Partial<ScheduleBuilderState>) => onChange({ ...value, ...patch }),
    [onChange, value],
  );

  const toggleWeekday = useCallback(
    (day: Weekday) => {
      const present = value.weekdays.includes(day);
      update({
        weekdays: present ? value.weekdays.filter((d) => d !== day) : [...value.weekdays, day],
      });
    },
    [update, value.weekdays],
  );

  const preview = buildScheduleString(value);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label className={`mb-1 ${LABEL_CLASS}`}>Repeat</Label>
        <Select value={value.mode} onValueChange={(v) => update({ mode: v as ScheduleMode })}>
          <SelectTrigger className="w-full" aria-label="Schedule mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODES.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {value.mode === 'interval' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={`mb-1 ${LABEL_CLASS}`}>Every</Label>
            <Input
              type="number"
              min={1}
              max={9999}
              value={String(value.intervalValue)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update({ intervalValue: Number.isFinite(n) && n > 0 ? n : 1 });
              }}
              className={FIELD_CLASS}
            />
          </div>
          <div>
            <Label className={`mb-1 ${LABEL_CLASS}`}>Unit</Label>
            <Select value={value.intervalUnit} onValueChange={(v) => update({ intervalUnit: v as IntervalUnit })}>
              <SelectTrigger className="w-full" aria-label="Interval unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((u) => (
                  <SelectItem key={u.value} value={u.value}>
                    {u.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {value.mode === 'daily' && (
        <TimeOfDayField label="Time" value={value.timeOfDay} onChange={(timeOfDay) => update({ timeOfDay })} />
      )}

      {value.mode === 'weekly' && (
        <>
          <div>
            <Label className={`mb-1 ${LABEL_CLASS}`}>Days</Label>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Weekdays">
              {WEEKDAY_INDEXES.map((d) => {
                const on = value.weekdays.includes(d);
                return (
                  <Button
                    key={d}
                    variant="ghost"
                    aria-pressed={on}
                    aria-label={WEEKDAY_SHORT[d]}
                    onClick={() => toggleWeekday(d)}
                    className={`h-auto sm:h-auto min-w-11 rounded-lg border px-2.5 py-1.5 ${
                      on ? 'border-brand bg-brand/10 text-brand' : 'border-border'
                    }`}>
                    <span className="text-xs font-semibold">{WEEKDAY_SHORT[d]}</span>
                  </Button>
                );
              })}
            </div>
            <div className="mt-1 text-[11px] text-neutral-400">No day selected runs every day.</div>
          </div>
          <TimeOfDayField label="Time" value={value.timeOfDay} onChange={(timeOfDay) => update({ timeOfDay })} />
        </>
      )}

      {value.mode === 'monthly' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className={`mb-1 ${LABEL_CLASS}`}>Day of month</Label>
            <Input
              type="number"
              min={1}
              max={31}
              value={String(value.dayOfMonth)}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                update({ dayOfMonth: Number.isFinite(n) && n >= 1 && n <= 31 ? n : 1 });
              }}
              className={FIELD_CLASS}
            />
          </div>
          <TimeOfDayField label="Time" value={value.timeOfDay} onChange={(timeOfDay) => update({ timeOfDay })} />
        </div>
      )}

      {value.mode === 'once' && (
        <div>
          <Label className={`mb-1 ${LABEL_CLASS}`}>Run at</Label>
          {/* Native datetime-local emits the exact "YYYY-MM-DDTHH:MM" shape
              parse_schedule accepts, so there is nothing to normalize. */}
          <Input
            type="datetime-local"
            value={value.onceAt}
            onChange={(e) => update({ onceAt: e.target.value })}
            className={FIELD_CLASS}
          />
        </div>
      )}

      {value.mode === 'custom' && (
        <div>
          <Label className={`mb-1 ${LABEL_CLASS}`}>Cron expression</Label>
          <Input
            value={value.custom}
            onChange={(e) => update({ custom: e.target.value })}
            placeholder="0 9 * * *"
            autoCapitalize="none"
            className={`font-mono ${FIELD_CLASS}`}
          />
          <div className="mt-1 text-[11px] text-neutral-400">
            Five fields: minute hour day-of-month month day-of-week.
          </div>
        </div>
      )}

      {/* Inline preview of what gets sent — lets users eyeball the result before
          saving, and keeps the schedule grammar discoverable in custom mode. */}
      <div className="text-[11px] text-neutral-400">
        Schedule: <span className="font-mono text-neutral-700 dark:text-neutral-300">{preview || '(incomplete)'}</span>
      </div>
    </div>
  );
}

function TimeOfDayField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <div>
      <Label className={`mb-1 ${LABEL_CLASS}`}>{label}</Label>
      {/* Native time picker is the right tool for "HH:MM": one control, respects
          the device's AM/PM preference, and round-trips without parsing. */}
      <Input type="time" value={value} onChange={(e) => onChange(e.target.value)} className={FIELD_CLASS} />
    </div>
  );
}
