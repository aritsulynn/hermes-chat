// Dashboard REST endpoints — the single source of truth for every path the app
// calls. These used to be inlined as string literals across ~8 screens, so a
// backend route change meant grepping the whole tree. Every builder here
// reproduces the exact string its call site used to inline.
//
// Pair with `opsGet` / `opsMut` (src/services/dashboard.ts) — these only build
// paths, they do no I/O. Route shapes follow the hermes-agent dashboard API.
//
// NOTE: this module deliberately has no imports. It is loaded directly by
// node's test runner (--experimental-strip-types), and node ESM does not do
// extensionless resolution. Keep it self-contained.

/** Append `profile=` to a path that may already carry a query string. An empty
 *  profile is omitted entirely (the server then applies its own default). */
export function withProfile(path: string, profile?: string | null): string {
  const selected = String(profile ?? '').trim();
  if (!selected) return path;
  return `${path}${path.includes('?') ? '&' : '?'}profile=${encodeURIComponent(selected)}`;
}

/** `?a=1` from a params object, skipping empty values. '' when nothing is set. */
function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : '';
}

/** Stored session ids may contain '/', and slashes must stay path separators
 *  while each segment gets encoded. */
function sessionPath(storedId: string): string {
  return storedId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** Mirrors DEFAULT_PROFILE in ./constants. Repeated here only because this
 *  module must stay import-free for the node test runner. */
const DEFAULT_PROFILE = 'default';

// ── Auth / status ───────────────────────────────────────────────────────────

/** GET /api/status → {auth_required, auth_providers} */
export const status = (): string => '/api/status';
/** POST /auth/password-login — session cookie comes back via Set-Cookie. */
export const passwordLogin = (): string => '/auth/password-login';
/** POST /auth/logout — best effort, local cleanup continues if it fails. */
export const logout = (): string => '/auth/logout';
/** POST /api/auth/ws-ticket — single-use, ~30s TTL. */
export const wsTicket = (): string => '/api/auth/ws-ticket';
/** GET /api/auth/me — verifies a session cookie survived a restart. */
export const authMe = (): string => '/api/auth/me';
/** WS upgrade path for a minted ticket. */
export const ws = (ticket: string): string => `/api/ws?ticket=${encodeURIComponent(ticket)}`;

// ── Profiles ────────────────────────────────────────────────────────────────

export const profiles = (): string => '/api/profiles';
export const activeProfile = (): string => '/api/profiles/active';

// ── Models ──────────────────────────────────────────────────────────────────

/** GET /api/model/options → {providers:[…]} */
export const modelOptions = (
  opts: { refresh?: boolean; includeUnconfigured?: boolean; profile?: string } = {},
): string =>
  `/api/model/options${query({
    refresh: opts.refresh ? 'true' : '',
    include_unconfigured: opts.includeUnconfigured ? 'true' : '',
    profile: String(opts.profile ?? '').trim(),
  })}`;

/** POST /api/model/set — the global ("main") default. Session-scoped switching
 *  goes through the WS `slash.exec` /model path instead. */
export const modelSet = (profile?: string): string => withProfile('/api/model/set', String(profile ?? '').trim());

// ── Sessions ────────────────────────────────────────────────────────────────

/** GET /api/sessions/{id}/messages — full rows incl. tool results + reasoning.
 *  WS session.history is only a compact projection. */
export const sessionMessages = (
  storedId: string,
  opts: { order?: 'latest' | 'oldest'; limit?: number; profile?: string } = {},
): string =>
  `/api/sessions/${sessionPath(storedId)}/messages${query({
    order: opts.order ?? 'latest',
    limit: opts.limit ?? 200,
    profile: String(opts.profile ?? '').trim() || DEFAULT_PROFILE,
  })}`;

/** Transcript for one cron run. Run ids are opaque, so the whole id is encoded
 *  (unlike stored session ids above, which keep their slashes). */
export const cronRunMessages = (runId: string, profile?: string | null, limit = 100): string =>
  withProfile(`/api/sessions/${encodeURIComponent(runId)}/messages${query({ order: 'oldest', limit })}`, profile);

/** Full-text session search (FTS5 message content + direct id hits). Deduped by
 *  compression lineage server-side. */
export const sessionsSearch = (q: string, profile?: string | null, limit = 20): string =>
  withProfile(`/api/sessions/search?q=${encodeURIComponent(q)}&limit=${limit}`, profile);

/** Full session JSON export (metadata + every message, including inactive rows).
 *  Streams `application/json`; the caller saves the raw body. */
export const sessionExport = (storedId: string, profile?: string | null): string =>
  withProfile(`/api/sessions/${sessionPath(storedId)}/export`, profile);

// ── Cron ────────────────────────────────────────────────────────────────────

/** Job list for one profile. */
export const cronJobs = (profile?: string | null): string => withProfile('/api/cron/jobs', profile);
/** Job list across every profile — the jobs screen's "all" view. */
export const cronJobsAllProfiles = (): string => '/api/cron/jobs?profile=all';
/** Where a run's output can be delivered: `local`, the platforms this gateway
 *  has connected, and one bot-chat target per local profile. `home_target_set`
 *  is false for a connected platform with no home channel configured yet.
 *  The server builds the list; a client must not guess a platform name. */
export const cronDeliveryTargets = (profile?: string | null): string =>
  withProfile('/api/cron/delivery-targets', String(profile ?? '').trim());
export const cronJob = (id: string, profile?: string | null): string =>
  withProfile(`/api/cron/jobs/${encodeURIComponent(id)}`, profile);
export type CronJobAction = 'pause' | 'resume' | 'trigger';
export const cronJobAction = (id: string, action: CronJobAction, profile?: string | null): string =>
  withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/${action}`, profile);
export const cronJobRuns = (id: string, profile?: string | null, limit = 30): string =>
  withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/runs${query({ limit })}`, profile);

// ── Kanban (plugin) ─────────────────────────────────────────────────────────

export const KANBAN_BASE = '/api/plugins/kanban';
export const kanbanBoards = (): string => `${KANBAN_BASE}/boards`;
export const kanbanBoardsWithArchived = (): string => `${KANBAN_BASE}/boards?include_archived=true`;
/** `boardQuery` is a leading '?' (e.g. '?board=main'), built by the screen. */
export const kanbanBoard = (boardQuery = ''): string => `${KANBAN_BASE}/board${boardQuery}`;
export const kanbanTasks = (boardQuery = ''): string => `${KANBAN_BASE}/tasks${boardQuery}`;
export const kanbanTask = (id: string, boardQuery = ''): string =>
  `${KANBAN_BASE}/tasks/${encodeURIComponent(id)}${boardQuery}`;

// ── Files ───────────────────────────────────────────────────────────────────

/** Listing for a path. The param is always sent, even when empty, so the
 *  server applies its own default rather than the client guessing one. */
export const files = (path: string): string => `/api/files?path=${encodeURIComponent(path)}`;
/** Listing with no `path` at all — the server picks the root. */
export const filesRoot = (): string => '/api/files';
export const fileRead = (path: string): string => `/api/files/read?path=${encodeURIComponent(path)}`;
export const filesMkdir = (): string => '/api/files/mkdir';
export const filesUpload = (): string => '/api/files/upload';

// ── Media ───────────────────────────────────────────────────────────────────

/** Preferred inline-media route. Returns {data_url}. */
export const media = (path: string): string => `/api/media?path=${encodeURIComponent(path)}`;
/** Fallback #1 — older gateways. Returns {dataUrl}. */
export const mediaReadDataUrl = (path: string): string => `/api/fs/read-data-url?path=${encodeURIComponent(path)}`;
/** Fallback #2. Returns {data_url}, like `media` but via the files router. */
export const mediaViaFiles = (path: string): string => `/api/files/read?path=${encodeURIComponent(path)}`;

// ── Logs ────────────────────────────────────────────────────────────────────

/** Caller decides whether `level` is sent at all — the logs screen omits it
 *  for its "ALL" sentinel while the ops screen always sends a real level. */
export const logs = (params: { file: string; lines: number | string; level?: string; search?: string }): string => {
  const search = new URLSearchParams({ file: params.file, lines: String(params.lines) });
  if (params.level) search.set('level', params.level);
  if (params.search) search.set('search', params.search);
  return `/api/logs?${search.toString()}`;
};

// ── Analytics ───────────────────────────────────────────────────────────────

export const usage = (days: number): string => `/api/analytics/usage?days=${days}`;
/** Ops screen's default window. */
export const usageLast7Days = (): string => usage(7);
/** Older gateways without the analytics route. */
export const portal = (): string => '/api/portal';

// ── Skills ──────────────────────────────────────────────────────────────────

export const skills = (): string => '/api/skills';
export const skillContent = (name: string): string => `/api/skills/content?name=${encodeURIComponent(name)}`;
export const skillToggle = (): string => '/api/skills/toggle';
/** PUT — full rewrite of an existing SKILL.md from the editor. */
export const skillContentUpdate = (): string => '/api/skills/content';
/** POST — create a new skill (name + optional category + SKILL.md body). */
export const skillCreate = (): string => '/api/skills';

// ── Skills hub ──────────────────────────────────────────────────────────────

/** GET — configured hub sources + installed provenance + featured skills. */
export const skillHubSources = (profile?: string | null): string =>
  withProfile('/api/skills/hub/sources', String(profile ?? '').trim());
/** GET — search every configured hub source. */
export const skillHubSearch = (q: string, opts: { source?: string; limit?: number; profile?: string | null } = {}): string =>
  withProfile(
    `/api/skills/hub/search?q=${encodeURIComponent(q)}&source=${encodeURIComponent(opts.source ?? 'all')}&limit=${opts.limit ?? 20}`,
    String(opts.profile ?? '').trim(),
  );
/** GET — a hub skill's SKILL.md + file manifest without installing. */
export const skillHubPreview = (identifier: string): string =>
  `/api/skills/hub/preview?identifier=${encodeURIComponent(identifier)}`;
/** GET — install-time security scan without installing. */
export const skillHubScan = (identifier: string): string =>
  `/api/skills/hub/scan?identifier=${encodeURIComponent(identifier)}`;
/** POST — install a hub skill by identifier (spawns a background action). */
export const skillHubInstall = (): string => '/api/skills/hub/install';
/** POST — uninstall an installed hub skill by name. */
export const skillHubUninstall = (): string => '/api/skills/hub/uninstall';
/** POST — update every installed hub skill. */
export const skillHubUpdate = (): string => '/api/skills/hub/update';

// ── Toolsets ────────────────────────────────────────────────────────────────

/** Unlike `withProfile`, an empty profile resolves to the default namespace
 *  rather than being omitted. */
function profileParam(profile?: string | null): string {
  return encodeURIComponent(String(profile ?? '').trim() || DEFAULT_PROFILE);
}
export const toolsets = (profile?: string | null): string => `/api/tools/toolsets?profile=${profileParam(profile)}`;
export const toolsetToggle = (name: string, profile?: string | null): string =>
  `/api/tools/toolsets/${encodeURIComponent(name)}?profile=${profileParam(profile)}`;
/** Provider matrix + per-env-var `is_set` flags for one toolset. */
export const toolsetConfig = (name: string, profile?: string | null): string =>
  `/api/tools/toolsets/${encodeURIComponent(name)}/config?profile=${profileParam(profile)}`;
/** PUT the active provider row for one toolset. */
export const toolsetProvider = (name: string, profile?: string | null): string =>
  `/api/tools/toolsets/${encodeURIComponent(name)}/provider?profile=${profileParam(profile)}`;
/** PUT one or more env vars (API keys) for a toolset backend. */
export const toolsetEnv = (name: string, profile?: string | null): string =>
  `/api/tools/toolsets/${encodeURIComponent(name)}/env?profile=${profileParam(profile)}`;
/** POST a provider's post-setup install hook (runs on the gateway host). */
export const toolsetPostSetup = (name: string, profile?: string | null): string =>
  `/api/tools/toolsets/${encodeURIComponent(name)}/post-setup?profile=${profileParam(profile)}`;

// ── Server update / gateway actions ─────────────────────────────────────────

/** Long-poll action log for a background action (e.g. `hermes update`). */
export const actionStatus = (name: string, lines: number): string =>
  `/api/actions/${encodeURIComponent(name)}/status?lines=${lines}`;
/** GET /api/hermes/update/check */
export const updateCheck = (opts: { force?: boolean; profile?: string } = {}): string =>
  `/api/hermes/update/check${query({
    force: opts.force ? 'true' : '',
    profile: String(opts.profile ?? '').trim(),
  })}`;
/** Durable outcome, readable across the dashboard's own restart. */
export const updateReceipt = (): string => '/api/hermes/update/receipt';
export const updateApply = (): string => '/api/hermes/update';
export const gatewayRestart = (): string => '/api/gateway/restart';
