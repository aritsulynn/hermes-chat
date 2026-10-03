// Pure helpers for the Kanban screen (column colors, payload normalization).
import type { BoardMeta, KanbanBoardData, KanbanTask } from './types';

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

/** `GET /api/kanban/boards` — the board switcher's chips. Malformed rows are
 *  dropped rather than rendered as an empty chip. */
export function asBoardList(raw: unknown): BoardMeta[] {
  const rows = Array.isArray((raw as { boards?: unknown })?.boards) ? (raw as { boards: unknown[] }).boards : [];
  return rows
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => ({
      slug: String(b.slug ?? ''),
      ...(typeof b.name === 'string' ? { name: b.name } : {}),
      ...(typeof b.is_current === 'boolean' ? { is_current: b.is_current } : {}),
      ...(typeof b.total === 'number' ? { total: b.total } : {}),
    }));
}

/** `GET /api/kanban/board` — one board's columns. */
export function asBoard(raw: unknown): KanbanBoardData {
  const cols = Array.isArray((raw as { columns?: unknown })?.columns) ? (raw as { columns: unknown[] }).columns : [];
  return {
    columns: cols.map((c: any) => ({
      name: String(c?.name ?? '(col)'),
      tasks: Array.isArray(c?.tasks) ? c.tasks.map(asTask) : [],
    })),
  };
}

/** Which board to open when nothing is chosen yet: the one this account last
 *  used, else the server's current, else the first. Mirrors the order the old
 *  `reload` walked. */
export function pickBoardSlug(list: BoardMeta[], saved: string | null): string {
  return (
    (saved && list.some((b) => b.slug === saved) && saved) ||
    list.find((b) => b.is_current)?.slug ||
    list[0]?.slug ||
    ''
  );
}
