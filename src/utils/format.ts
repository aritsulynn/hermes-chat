// Compact-number formatter, ported from the TUI/desktop shared module
// (apps/shared/src/format.ts). 999 → "999", 1000 → "1k", 1230 → "1.2k",
// 1_500_000 → "1.5M". `M` is the top rung by design.
export function compactNumber(value: null | number | undefined): string {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num) || num <= 0) return '0';
  const scaled = (v: number, suffix: string) => `${v.toFixed(1).replace(/\.0$/, '')}${suffix}`;
  // Thresholds sit just under the unit boundary so rounding can't produce
  // "1000k" or "1000" — those promote to the next unit instead.
  if (num >= 999_950) return scaled(num / 1_000_000, 'M');
  if (num >= 999.5) return scaled(num / 1_000, 'k');
  return `${Math.round(num)}`;
}

/** Human-readable byte size: 0 → "0 B", 1536 → "1.5 KB". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '-';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Epoch-seconds → "Sep 26, 14:05" (adds the year when not the current year). */
export function formatDate(mtime: number): string {
  if (!Number.isFinite(mtime) || mtime <= 0) return '-';
  const d = new Date(mtime * 1000);
  const now = new Date();
  const isThisYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(isThisYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * `session.list` row `source` → a short badge label, or null when the row is
 * not worth tagging.
 *
 * The vocabulary is the gateway's, not ours (hermes-agent):
 * `_resolve_session_source` falls back to the *server's* platform env when a
 * client sends none — `desktop` with HERMES_DESKTOP=1, else `tui` — and never
 * rewrites an explicit caller value. `kanban`/`tool`/`oneshot` are dropped from
 * every listing by INTERNAL_LISTING_SOURCES; `unknown` is listed but never
 * auto-resumed.
 *
 * So `tui`/`desktop`/`local` all mean "a human opened a chat" — the
 * uninteresting default — and only rows the user did not type into this app are
 * worth a badge. This app sends `source: 'local'` on create so its own sessions
 * stop inheriting the server's `tui` label.
 */
const AUTOMATED_SESSION_SOURCES: Record<string, string> = {
  cron: 'Cron',
  telegram: 'Telegram',
  api: 'API',
  bot_room: 'Room',
  unknown: 'Unknown',
};

export function formatSessionSource(source: string | null | undefined): string | null {
  const key = String(source ?? '')
    .trim()
    .toLowerCase();
  if (!key) return null;
  return AUTOMATED_SESSION_SOURCES[key] ?? null;
}

/**
 * Epoch-seconds → "now" / "12m" / "3h" / "2d", falling back to an absolute
 * date past a week. For chat rows, where "Sep 24" is easier to place than a
 * bare "14d". Returns '' for missing/unusable values so callers can render the
 * row without a placeholder.
 */
export function formatRelative(
  epochSeconds: number | null | undefined,
  nowMs: number = Date.now(),
): string {
  if (epochSeconds === null || epochSeconds === undefined) return '';
  // Accept millis too — a caller that already normalised shouldn't have to care.
  const ms = epochSeconds < 1e11 ? epochSeconds * 1000 : epochSeconds;
  if (!Number.isFinite(ms) || ms <= 0) return '';
  const diff = Math.round((nowMs - ms) / 1000);
  // A stamp in the future is clock skew, not age — don't render "in -3m".
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return formatDate(epochSeconds);
}

/** Normalize a seconds-or-millis timestamp (number or string) to epoch millis. */
export function toEpochMs(ts: number | string | null | undefined): number | null {
  if (ts === null || ts === undefined || ts === '') return null;
  if (typeof ts === 'number') return ts < 1e11 ? ts * 1000 : ts;
  const n = Number(ts);
  if (!isNaN(n)) return n < 1e11 ? n * 1000 : n;
  const d = new Date(ts).getTime();
  return isNaN(d) ? null : d;
}

/** ISO string → "Sep 26, 14:05"; falls back to the raw value when unparseable. */
export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

/** Like {@link formatDateTime} but with seconds, for run timestamps. */
export function formatRunTime(ts?: number | string | null): string {
  if (!ts) return '—';
  try {
    const ms = toEpochMs(ts);
    if (ms === null) return String(ts);
    const date = new Date(ms);
    if (isNaN(date.getTime())) return String(ts);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

/** Elapsed time between two timestamps: "12s", "3m", "3m 20s". */
export function formatRunDuration(
  started?: number | string | null,
  ended?: number | string | null,
): string | null {
  if (!started || !ended) return null;
  const s = toEpochMs(started);
  const e = toEpochMs(ended);
  if (s === null || e === null || isNaN(s) || isNaN(e) || e < s) return null;
  const diffSec = Math.round((e - s) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.floor(diffSec / 60);
  const remSec = diffSec % 60;
  return remSec > 0 ? `${m}m ${remSec}s` : `${m}m`;
}

/** USD cost, with "<$0.01" for tiny non-zero amounts. */
export function formatCost(usd: number | undefined | null): string {
  if (usd === undefined || usd === null || usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

/** "2026-09-26" → "26/09" (day/month), for compact axis labels. */
export function formatDayLabel(dayStr: string): string {
  try {
    const parts = dayStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return dayStr;
  } catch {
    return dayStr;
  }
}
