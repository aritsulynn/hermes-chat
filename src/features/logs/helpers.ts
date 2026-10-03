// Log viewer constants and line-severity classification.
export const LOG_FILES = ['agent', 'errors', 'gateway', 'mcp'] as const;
export type LogFile = (typeof LOG_FILES)[number];

export const LOG_LEVELS = ['ALL', 'INFO', 'WARNING', 'ERROR', 'DEBUG'] as const;
export type LogLevelFilter = (typeof LOG_LEVELS)[number];

export const LINE_COUNTS = [50, 100, 200, 500] as const;

export type LineSeverity = 'error' | 'warning' | 'info' | 'debug';

/** `GET /api/logs` — the payload's `lines`, as a string array.
 *
 *  A non-string row is dropped rather than rendered: the list interpolates each
 *  entry straight into a `<div>`, so one object from a half-written log line
 *  would throw during render and take the whole screen with it. */
export function asLogLines(raw: unknown): string[] {
  const rows = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { lines?: unknown }).lines : undefined;
  return Array.isArray(rows) ? rows.filter((l): l is string => typeof l === 'string') : [];
}

export const LEVEL_COLORS: Record<LogLevelFilter, { activeBg: string; activeText: string; activeBorder: string }> = {
  ALL: {
    activeBg: 'bg-neutral-900 dark:bg-neutral-100',
    activeText: 'text-white dark:text-neutral-950',
    activeBorder: 'border-neutral-900 dark:border-border',
  },
  INFO: {
    activeBg: 'bg-blue-600',
    activeText: 'text-white',
    activeBorder: 'border-blue-600',
  },
  WARNING: {
    activeBg: 'bg-amber-600',
    activeText: 'text-white',
    activeBorder: 'border-amber-600',
  },
  ERROR: {
    activeBg: 'bg-rose-600',
    activeText: 'text-white',
    activeBorder: 'border-rose-600',
  },
  DEBUG: {
    activeBg: 'bg-indigo-600',
    activeText: 'text-white',
    activeBorder: 'border-indigo-600',
  },
};

const LEVEL_TOKEN_RE = /^\d{4}-\d{2}-\d{2}[ T][\d:,.]+\s+(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL|FATAL)\b/;

export function classifyLine(line: string): LineSeverity {
  const token = LEVEL_TOKEN_RE.exec(line)?.[1];
  if (token) {
    if (token === 'ERROR' || token === 'CRITICAL' || token === 'FATAL') return 'error';
    if (token === 'WARNING' || token === 'WARN') return 'warning';
    if (token === 'DEBUG') return 'debug';
    return 'info';
  }
  const upper = line.toUpperCase();
  if (/\b(ERROR|CRITICAL|FATAL)\b/.test(upper) || upper.startsWith('TRACEBACK (')) {
    return 'error';
  }
  if (/\b(WARNING|WARN)\b/.test(upper)) return 'warning';
  if (/\bDEBUG\b/.test(upper)) return 'debug';
  return 'info';
}
