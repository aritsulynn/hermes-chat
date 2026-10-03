// Pure helpers for the Cron Jobs screen (no React/JSX).
import type { CronJobItem, CronRunItem, RunMessageItem } from './types';

export const SCHEDULE_PRESETS = [
  { label: 'Every hour', expr: '0 * * * *' },
  { label: 'Daily at 09:00', expr: '0 9 * * *' },
  { label: 'Mon at 08:00', expr: '0 8 * * 1' },
  { label: 'Weekdays 09:00', expr: '0 9 * * 1-5' },
  { label: 'Every 15 min', expr: '*/15 * * * *' },
];

export function getScheduleExpr(job: CronJobItem): string {
  if (job.schedule_display) return job.schedule_display;
  if (typeof job.schedule === 'string') return job.schedule;
  if (job.schedule && typeof job.schedule === 'object' && job.schedule.expr) {
    return job.schedule.expr;
  }
  return '';
}

export function parseMessageContent(content: any): string {
  if (typeof content === 'string') return content;
  if (!content) return '';
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.text) return String(part.text);
        return JSON.stringify(part);
      })
      .join('\n');
  }
  if (typeof content === 'object') {
    return content.text || JSON.stringify(content, null, 2);
  }
  return String(content);
}

/** One array out of a payload that may be the bare array or wrap it in a field.
 *
 *  All three cron list endpoints have answered both ways, so every list on this
 *  screen normalises through here rather than repeating the two-step check. */
function rowsOf(raw: unknown, field: string): unknown[] {
  if (Array.isArray(raw)) return raw;
  const wrapped = raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[field] : undefined;
  return Array.isArray(wrapped) ? wrapped : [];
}

/** `GET /api/cron/jobs` — every profile's jobs. */
export function asCronJobs(raw: unknown): CronJobItem[] {
  return rowsOf(raw, 'jobs') as CronJobItem[];
}

/** `GET /api/cron/jobs/{id}/runs`. */
export function asCronRuns(raw: unknown): CronRunItem[] {
  return rowsOf(raw, 'runs') as CronRunItem[];
}

/** `GET /api/cron/runs/{id}/messages`. */
export function asRunMessages(raw: unknown): RunMessageItem[] {
  return rowsOf(raw, 'messages') as RunMessageItem[];
}

/** One row of `GET /api/cron/delivery-targets`. */
export interface DeliveryTarget {
  id: string;
  name: string;
  /** A connected platform with no home channel yet: selectable, but delivering
   *  there would go nowhere until the user sets one. */
  home_target_set: boolean;
  home_env_var?: string | null;
}

/** `deliver: 'local'` — run the job, keep the transcript, send nothing. The
 *  server's own default (scheduler_delivery._resolve_single_delivery_target
 *  returns None for it) and the one option that always works. */
export const LOCAL_DELIVERY = 'local';

/** `GET /api/cron/delivery-targets` — rows without an id are dropped, since the
 *  id is what a job's `deliver` field is matched against. A malformed row would
 *  otherwise render as an option the server cannot accept. */
export function asDeliveryTargets(raw: unknown): DeliveryTarget[] {
  const targets: DeliveryTarget[] = [];
  for (const row of rowsOf(raw, 'targets')) {
    const t = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    if (!id) continue;
    targets.push({
      id,
      name: typeof t.name === 'string' && t.name ? t.name : id,
      home_target_set: t.home_target_set !== false,
      home_env_var: typeof t.home_env_var === 'string' ? t.home_env_var : null,
    });
  }
  return targets;
}

/**
 * The `deliver` options to offer, in server order.
 *
 * `origin` leads when the job has one: it sends back to wherever the job was
 * created, which is what a job started from a chat wants. The server resolves
 * it to that origin and falls back to a home channel when there is none
 * (scheduler_delivery._resolve_single_delivery_target), so it is always safe to
 * offer.
 */
export function deliveryOptions(targets: DeliveryTarget[], opts: { hasOrigin?: boolean } = {}): DeliveryTarget[] {
  // The server's own list already carries a `local` row. Prepending a synthetic
  // one unconditionally produced two options keyed `local` — a React
  // duplicate-key warning and the same target twice in the form (see the
  // desktop, which filters `target.id !== "local"`). So prefer the server's
  // row and only synthesize `local` when the fetch failed and the list is empty.
  const serverLocal = targets.find((t) => t.id === LOCAL_DELIVERY);
  const local: DeliveryTarget = serverLocal ?? {
    id: LOCAL_DELIVERY,
    name: 'Save only (no notification)',
    home_target_set: true,
  };
  // `origin` is prepended by the server per blueprint, so it is never in the
  // list; drop a stray one just in case so the key stays unique.
  const rest = targets.filter((t) => t.id !== LOCAL_DELIVERY && t.id !== 'origin');
  if (!opts.hasOrigin) return [local, ...rest];
  const origin: DeliveryTarget = {
    id: 'origin',
    name: 'Back to where it was created',
    home_target_set: true,
  };
  return [local, origin, ...rest];
}

/** A job's current `deliver`, normalised to something selectable.
 *
 * Older jobs and the failure path can hold a value this gateway no longer
 * offers (a platform that has since been disconnected). Keeping the raw value
 * is deliberate: silently rewriting it to `local` on the next save would
 * downgrade a job the user still wants delivered, so the row is shown as-is
 * and the form starts from the closest offered option.
 */
export function normaliseDelivery(raw: string | null | undefined, options: DeliveryTarget[]): string {
  const value = String(raw ?? '').trim();
  if (!value) return LOCAL_DELIVERY;
  // A comma-joined list is a broadcast to several targets; the form edits one
  // target at a time, so open on the first one.
  const first = value.split(',')[0].trim();
  if (options.some((o) => o.id === first)) return first;
  if (options.some((o) => o.id === value)) return value;
  return LOCAL_DELIVERY;
}
