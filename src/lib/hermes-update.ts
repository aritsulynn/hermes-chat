// Pure helpers for the Hermes **server** update flow (Settings → About).
//
// Backend contract (hermes_cli/web_routers/actions.py, verified against 0.21.4):
//   GET  /api/hermes/update/check           → availability, no side effects
//   POST /api/hermes/update                 → spawns `hermes update` in the background
//   GET  /api/actions/hermes-update/status  → live log tail + running/exit_code + receipt
//   GET  /api/hermes/update/receipt         → durable structured outcome (404 when none)
//   POST /api/gateway/restart               → finishes the update by restarting the gateway
//
// The dashboard web UI polls the action status (~1.2s) until the process exits;
// this module keeps the parsing/labels pure so they can be unit-tested without
// a socket or a running dashboard.

export interface UpdateCommit {
  sha: string;
  summary: string;
  author: string;
  at: number;
}

/** Normalized `GET /api/hermes/update/check` payload. */
export interface UpdateCheck {
  installMethod: string;
  currentVersion: string;
  /** Commits behind: 0 = up to date, -1/other = unknown, null = check could not run. */
  behind: number | null;
  updateAvailable: boolean;
  /** True for git installs — the dashboard (and this app) can apply in place. */
  canApply: boolean;
  updateCommand: string;
  message: string;
  commits: UpdateCommit[];
}

/** Compact receipt summary embedded in the action status / receipt endpoint. */
export interface UpdateReceiptSummary {
  outcome: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  preSha: string | null;
  postSha: string | null;
  postVersion: string | null;
  fleetStates: string[];
}

/** Normalized `GET /api/actions/{name}/status` payload. */
export interface ActionStatus {
  name: string;
  running: boolean;
  exitCode: number | null;
  pid: number | null;
  lines: string[];
  actionId: string | null;
  receipt: UpdateReceiptSummary | null;
}

export type UpdateTone = 'success' | 'warning' | 'danger' | 'muted';

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Coerce a raw check payload into a stable shape (missing fields → safe defaults). */
export function normalizeUpdateCheck(raw: unknown): UpdateCheck {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const commits = Array.isArray(r.commits) ? r.commits : [];
  return {
    installMethod: str(r.install_method) || 'unknown',
    currentVersion: str(r.current_version),
    behind: num(r.behind),
    updateAvailable: r.update_available === true,
    canApply: r.can_apply === true,
    updateCommand: str(r.update_command),
    message: str(r.message),
    commits: commits
      .filter((c) => c && typeof c === 'object')
      .map((c) => {
        const row = c as Record<string, unknown>;
        return {
          sha: str(row.sha),
          summary: str(row.summary),
          author: str(row.author),
          at: num(row.at) ?? 0,
        };
      }),
  };
}

export function normalizeReceiptSummary(raw: unknown): UpdateReceiptSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  return {
    outcome: r.outcome == null ? null : str(r.outcome),
    startedAt: r.started_at == null ? null : str(r.started_at),
    finishedAt: r.finished_at == null ? null : str(r.finished_at),
    preSha: r.pre_sha == null ? null : str(r.pre_sha),
    postSha: r.post_sha == null ? null : str(r.post_sha),
    postVersion: r.post_version == null ? null : str(r.post_version),
    fleetStates: Array.isArray(r.fleet_states) ? r.fleet_states.map(str).filter(Boolean) : [],
  };
}

/** Coerce a raw action-status payload into a stable shape. */
export function normalizeActionStatus(raw: unknown): ActionStatus {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    name: str(r.name),
    running: r.running === true,
    exitCode: num(r.exit_code),
    pid: num(r.pid),
    lines: Array.isArray(r.lines) ? r.lines.map(str) : [],
    actionId: r.action_id == null ? null : str(r.action_id),
    receipt: normalizeReceiptSummary(r.receipt),
  };
}

/** Human status line for the update chip. */
export function updateStatusLabel(info: UpdateCheck | null): string {
  if (!info) return 'Not checked';
  if (info.updateAvailable) {
    return info.behind && info.behind > 0
      ? `${info.behind} commit${info.behind === 1 ? '' : 's'} behind`
      : 'Update available';
  }
  if (!info.canApply) {
    if (info.message) return 'Managed externally';
    return info.installMethod && info.installMethod !== 'unknown'
      ? `Managed (${info.installMethod})`
      : 'Not applyable here';
  }
  if (info.behind === 0) return 'Up to date';
  if (info.behind === null) return "Couldn't check";
  return 'Up to date';
}

export function updateStatusTone(info: UpdateCheck | null): UpdateTone {
  if (!info) return 'muted';
  if (info.updateAvailable) return 'warning';
  if (info.behind === 0) return 'success';
  if (info.behind === null) return 'warning';
  return 'muted';
}

/** Chip text for a running/finished background action log. */
export function actionOutcomeLabel(running: boolean, exitCode: number | null): string {
  if (running) return 'running';
  if (exitCode === 0) return 'done';
  if (exitCode === null) return 'finished';
  return `exit ${exitCode}`;
}

export function actionOutcomeTone(running: boolean, exitCode: number | null): UpdateTone {
  if (running) return 'warning';
  if (exitCode === 0) return 'success';
  if (exitCode === null) return 'muted';
  return 'danger';
}

const RECEIPT_OUTCOMES: Record<string, string> = {
  success: 'Update succeeded',
  partial: 'Update partially applied',
  failed: 'Update failed',
  refused: 'Update refused',
  aborted: 'Update aborted',
  skipped: 'Update skipped',
};

/** Durable, structured outcome from the receipt (the truth across the restart gap). */
export function receiptOutcomeLabel(receipt: UpdateReceiptSummary | null): string {
  if (!receipt?.outcome) return '';
  const base = RECEIPT_OUTCOMES[receipt.outcome] ?? `Update ${receipt.outcome}`;
  if (receipt.outcome === 'success' && receipt.postVersion) {
    const version = receipt.postVersion.startsWith('v')
      ? receipt.postVersion
      : `v${receipt.postVersion}`;
    return `${base} — now ${version}`;
  }
  return base;
}

export function receiptOutcomeTone(receipt: UpdateReceiptSummary | null): UpdateTone {
  if (!receipt?.outcome) return 'muted';
  if (receipt.outcome === 'success') return 'success';
  if (receipt.outcome === 'partial') return 'warning';
  return 'danger';
}
