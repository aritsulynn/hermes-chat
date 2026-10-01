// Pure helpers for the Cron Jobs screen (no React/JSX).
import type { CronJobItem } from './types';

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

export function scopedRunKey(runId: string, profile?: string | null): string {
  return JSON.stringify([String(profile ?? '').trim(), runId]);
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
  const local: DeliveryTarget = {
    id: LOCAL_DELIVERY,
    name: 'Save only (no notification)',
    home_target_set: true,
  };
  if (!opts.hasOrigin) return [local, ...targets];
  const origin: DeliveryTarget = {
    id: 'origin',
    name: 'Back to where it was created',
    home_target_set: true,
  };
  return [local, origin, ...targets];
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
