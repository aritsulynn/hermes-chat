// Pure helpers for the Kanban screen (column colors, task normalization).
import type { KanbanTask } from './types';

// Column dot colors (same tones as the desktop COLUMN_META).
export const COLUMN_DOT: Record<string, string> = {
  triage: '#9ca3af',
  todo: '#9ca3af',
  scheduled: '#a78bfa',
  ready: '#60a5fa',
  running: '#34d399',
  blocked: '#f87171',
  review: '#fbbf24',
  done: '#9ca3af',
  archived: '#6b7280',
};

export const dotOf = (name: string) => COLUMN_DOT[name] ?? '#60a5fa';

export function asTask(r: any): KanbanTask {
  return {
    id: String(r?.id ?? ''),
    title: String(r?.title ?? '(untitled)'),
    body: typeof r?.body === 'string' ? r.body : null,
    status: String(r?.status ?? ''),
    assignee: typeof r?.assignee === 'string' ? r.assignee : null,
    priority: typeof r?.priority === 'number' ? r.priority : null,
    progress:
      r?.progress && typeof r.progress === 'object'
        ? { done: Number(r.progress.done ?? 0), total: Number(r.progress.total ?? 0) }
        : null,
    warnings: r?.warnings && typeof r.warnings === 'object' ? { count: Number(r.warnings.count ?? 0) } : null,
    comment_count: typeof r?.comment_count === 'number' ? r.comment_count : null,
  };
}
