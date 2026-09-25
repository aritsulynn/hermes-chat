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
