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
export const profile = (name: string): string => `/api/profiles/${encodeURIComponent(name)}`;
export const profileSoul = (name: string): string => `/api/profiles/${encodeURIComponent(name)}/soul`;
export const profileDescription = (name: string): string => `/api/profiles/${encodeURIComponent(name)}/description`;
export const profileModel = (name: string): string => `/api/profiles/${encodeURIComponent(name)}/model`;
export const profileDescribeAuto = (name: string): string => `/api/profiles/${encodeURIComponent(name)}/describe-auto`;
export const profileExport = (name: string): string => `/api/profiles/${encodeURIComponent(name)}/export`;
export const profileImport = (): string => '/api/profiles/import';

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
/** Resolved metadata for the configured model (context length + capabilities). */
export const modelInfo = (profile?: string | null): string =>
  withProfile('/api/model/info', String(profile ?? '').trim());
/** Current auxiliary task assignments + the main slot. */
export const modelAuxiliary = (profile?: string | null): string =>
  withProfile('/api/model/auxiliary', String(profile ?? '').trim());
/** Configured Mixture-of-Agents slots. */
export const modelMoa = (profile?: string | null): string =>
  withProfile('/api/model/moa', String(profile ?? '').trim());
/** Recommended default model for a provider. */
export const modelRecommendedDefault = (provider: string, profile?: string | null): string =>
  withProfile(`/api/model/recommended-default?provider=${encodeURIComponent(provider)}`, profile);

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

// ── Config ──────────────────────────────────────────────────────────────────

/** Raw config.yaml text plus its resolved path. */
export const configRaw = (profile?: string | null): string => withProfile('/api/config/raw', profile);
/** Normalized config object (form surface). */
export const configObject = (profile?: string | null): string => withProfile('/api/config', profile);
/** Schema-driven field metadata. */
export const configSchema = (profile?: string | null): string => withProfile('/api/config/schema', profile);
/** Built-in defaults, for a scoped reset. */
export const configDefaults = (): string => '/api/config/defaults';

// ── Env / Keys ──────────────────────────────────────────────────────────────

/** All env vars with set/redacted metadata (channel-managed keys excluded). */
export const envVars = (profile?: string | null): string => withProfile('/api/env', profile);
/** Return the real value of one env var (token-gated + rate limited). */
export const envReveal = (): string => '/api/env/reveal';
/** Live-probe a provider credential before saving. */
export const providerValidate = (): string => '/api/providers/validate';
/** Custom provider endpoints (config.yaml `providers.*`). */
export const customEndpoints = (): string => '/api/providers/custom-endpoints';
export const customEndpointActivate = (id: string): string =>
  `/api/providers/custom-endpoints/${encodeURIComponent(id)}/activate`;
export const customEndpointValidate = (): string => '/api/providers/custom-endpoints/validate';

// ── Plugins ─────────────────────────────────────────────────────────────────

/** Agent plugins + dashboard extension metadata (session protected). */
export const pluginsHub = (profile?: string | null): string => withProfile('/api/dashboard/plugins/hub', profile);
/** Curated plugin catalog merged with installed state. */
export const pluginsCatalog = (): string => '/api/dashboard/plugins/catalog';
/** Force a rescan of dashboard plugins. */
export const pluginsRescan = (): string => '/api/dashboard/plugins/rescan';
/** Installed-plugin toggle for sidebar visibility. */
export const pluginVisibility = (name: string): string =>
  `/api/dashboard/plugins/${encodeURIComponent(name)}/visibility`;
/** Agent plugin lifecycle. `name` may contain a path segment (repo/name). */
export const agentPlugin = (name: string): string => `/api/dashboard/agent-plugins/${encodeURI(name)}`;
export const agentPluginInstall = (): string => '/api/dashboard/agent-plugins/install';
export const agentPluginEnable = (name: string): string => `${agentPlugin(name)}/enable`;
export const agentPluginDisable = (name: string): string => `${agentPlugin(name)}/disable`;
export const agentPluginUpdate = (name: string): string => `${agentPlugin(name)}/update`;
/** Memory provider / context engine selection (writes config.yaml). */
export const pluginProviders = (profile?: string | null): string =>
  withProfile('/api/dashboard/plugin-providers', profile);
/** Backend memory-provider status + provider picker metadata. */
export const memoryStatus = (profile?: string | null): string => withProfile('/api/memory', profile);
export const memoryProviderSetup = (name: string): string => `/api/memory/providers/${encodeURIComponent(name)}/setup`;

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
/** Per-model breakdown (provider, cost, sessions, capabilities). */
export const usageModels = (days: number): string => `/api/analytics/models?days=${days}`;
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
export const skillHubSearch = (
  q: string,
  opts: { source?: string; limit?: number; profile?: string | null } = {},
): string =>
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

// ── MCP servers ─────────────────────────────────────────────────────────────

/** GET — configured MCP servers (redacted env, enabled state). */
export const mcpServers = (profile?: string | null): string => withProfile('/api/mcp/servers', profile);
/** POST — add a server; PUT replaces the whole map. */
export const mcpServersSave = (): string => '/api/mcp/servers';
export const mcpServer = (name: string): string => `/api/mcp/servers/${encodeURIComponent(name)}`;
/** PUT — toggle one server's `enabled`. */
export const mcpServerEnabled = (name: string): string => `/api/mcp/servers/${encodeURIComponent(name)}/enabled`;
/** POST — probe a server, returning its tools/prompts/resources. */
export const mcpServerTest = (name: string): string => `/api/mcp/servers/${encodeURIComponent(name)}/test`;
/** POST — start MCP OAuth, returning the authorization URL. */
export const mcpServerAuth = (name: string): string => `/api/mcp/servers/${encodeURIComponent(name)}/auth`;
/** GET — Nous-approved catalog, annotated installed/enabled. */
export const mcpCatalog = (profile?: string | null): string => withProfile('/api/mcp/catalog', profile);
/** POST — install a catalog entry (env secrets, optional background git clone). */
export const mcpCatalogInstall = (): string => '/api/mcp/catalog/install';

// ── Messaging / channels ────────────────────────────────────────────────────

export const messagingPlatforms = (profile?: string | null): string => withProfile('/api/messaging/platforms', profile);
export const messagingPlatform = (platformId: string): string =>
  `/api/messaging/platforms/${encodeURIComponent(platformId)}`;
export const messagingPlatformTest = (platformId: string): string =>
  `/api/messaging/platforms/${encodeURIComponent(platformId)}/test`;
/** Telegram QR/deep-link onboarding. */
export const telegramOnboardingStart = (): string => '/api/messaging/telegram/onboarding/start';
export const telegramOnboarding = (pairingId: string): string =>
  `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}`;
export const telegramOnboardingApply = (pairingId: string): string =>
  `/api/messaging/telegram/onboarding/${encodeURIComponent(pairingId)}/apply`;
/** WhatsApp QR onboarding. */
export const whatsappOnboardingStart = (): string => '/api/messaging/whatsapp/onboarding/start';
export const whatsappOnboarding = (pairingId: string): string =>
  `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}`;
export const whatsappOnboardingApply = (pairingId: string): string =>
  `/api/messaging/whatsapp/onboarding/${encodeURIComponent(pairingId)}/apply`;

// ── Pairing ─────────────────────────────────────────────────────────────────

export const pairing = (): string => '/api/pairing';
export const pairingApprove = (): string => '/api/pairing/approve';
export const pairingRevoke = (): string => '/api/pairing/revoke';
export const pairingClearPending = (): string => '/api/pairing/clear-pending';

// ── Webhooks ────────────────────────────────────────────────────────────────

export const webhooks = (profile?: string | null): string => withProfile('/api/webhooks', profile);
export const webhooksEnable = (): string => '/api/webhooks/enable';
export const webhook = (name: string): string => `/api/webhooks/${encodeURIComponent(name)}`;
export const webhookEnabled = (name: string): string => `/api/webhooks/${encodeURIComponent(name)}/enabled`;

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

// ── System / ops ────────────────────────────────────────────────────────────

/** GET /api/system/stats — host + process CPU/memory/disk/uptime. */
export const systemStats = (): string => '/api/system/stats';
/** GET /api/health — machine-level health probe. */
export const health = (): string => '/api/health';
/** POST /api/gateway/start | /stop. */
export const gatewayStart = (): string => '/api/gateway/start';
export const gatewayStop = (): string => '/api/gateway/stop';
/** GET — curator (skill maintenance) status; POST `/run` triggers a pass. */
export const curator = (): string => '/api/curator';
export const curatorRun = (): string => '/api/curator/run';
/** GET /api/credentials — redacted credential pool. */
export const credentials = (): string => '/api/credentials';
export const credentialsPool = (): string => '/api/credentials/pool';
export const credentialsPoolEntry = (provider: string, index: number): string =>
  `/api/credentials/pool/${encodeURIComponent(provider)}/${index}`;
/** Ops one-shots: doctor, security audit, backup, checkpoints. */
export const opsDoctor = (): string => '/api/ops/doctor';
export const opsSecurityAudit = (): string => '/api/ops/security-audit';
export const opsBackup = (): string => '/api/ops/backup';
export const opsBackupDownload = (archive?: string): string =>
  archive ? `/api/ops/backup/download?archive=${encodeURIComponent(archive)}` : '/api/ops/backup/download';
export const opsCheckpoints = (): string => '/api/ops/checkpoints';
export const opsCheckpointsPrune = (): string => '/api/ops/checkpoints/prune';

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
