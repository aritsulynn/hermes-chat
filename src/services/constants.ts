// Shared constants — one place for values that used to be inlined across
// screens. No imports: keep this module a leaf so anything can depend on it.
//
// Scope is deliberately narrow: protocol-level values (wire timeouts, buffer
// caps, request limits) that appear in more than one module, or that encode a
// contract with the gateway. Purely local UI timings (toast resets, debounce
// delays) stay next to the code that owns them.

// ── Profiles ────────────────────────────────────────────────────────────────

/** Profile namespace used whenever the dashboard reports no active profile.
 *  Keep this the ONLY spelling of the literal — storage keys, query params and
 *  React state all derive from it. */
export const DEFAULT_PROFILE = 'default';

// ── HTTP (src/services/dashboard.ts) ────────────────────────────────────────

/** Default ceiling for a single dashboard REST call. */
export const HTTP_TIMEOUT_MS = 15000;
/** /api/status — a dead host must fail fast so the login screen can explain. */
export const HTTP_PROBE_TIMEOUT_MS = 8000;
export const HTTP_LOGIN_TIMEOUT_MS = 15000;
/** WS tickets are single-use with a ~30s server TTL; don't outlast it. */
export const HTTP_TICKET_TIMEOUT_MS = 10000;
/** Session verification on boot. */
export const HTTP_SESSION_CHECK_TIMEOUT_MS = 8000;
/** Best-effort logout — never blocks local cleanup. */
export const HTTP_LOGOUT_TIMEOUT_MS = 8000;
export const HTTP_MODEL_OPTIONS_TIMEOUT_MS = 15000;
/** Generic ops screens (cron, files, skills, kanban, update). */
export const HTTP_API_TIMEOUT_MS = 20000;
export const HTTP_SESSION_MESSAGES_TIMEOUT_MS = 20000;

/** Transcripts are refetched in bursts (toolRefresh + stampRowIds + resync). */
export const SESSION_MESSAGES_TTL_MS = 5000;
export const SESSION_MESSAGES_LIMIT = 200;
/** Bounded so long sessions don't grow the map without limit. */
export const SESSION_MESSAGES_CACHE_MAX = 20;

// ── Chat transcript windowing (store + chat screen) ────────────────────────
// The REST transcript has no cursor — only `order + limit` — so paging grows
// the tail limit and the client prepends just the older slice (see
// sliceOlderThan in utils/messages). Steady state keeps ~1 page in JS memory
// instead of the whole 10k-message transcript.

/** REST rows fetched for the initial transcript tail. */
export const CHAT_HISTORY_PAGE = 120;
/** Safety ceiling for one growing-limit history fetch. */
export const CHAT_HISTORY_MAX_ROWS = 1200;
/** Bubbles that trigger a head trim (live accumulation guard). */
export const CHAT_WINDOW_SOFT_CAP = 800;
/** Bubbles kept after a head trim. */
export const CHAT_WINDOW_TRIM_KEEP = 600;

// ── Gateway WebSocket (src/services/gateway-ws.ts) ──────────────────────────

/** gateway.ping heartbeat. */
export const WS_HEARTBEAT_MS = 15000;
export const WS_INITIAL_BACKOFF_MS = 1000;
export const WS_MAX_BACKOFF_MS = 15000;
/** Wait for gateway.ready before giving up on a dial. */
export const WS_CONNECT_TIMEOUT_MS = 15000;
/** Safety net so a lost reply never hangs the UI. */
export const WS_RPC_TIMEOUT_MS = 120000;
/** session.events.since — a slow replay shouldn't trip the RPC ceiling. */
export const WS_REPLAY_TIMEOUT_MS = 20000;
/** Deltas arrive ~30Hz; coalesce into one setState per window. */
export const WS_TOKEN_FLUSH_MS = 50;
/** Cap on live frames parked while a replay fetch is in flight. */
export const WS_REPLAY_HOLD_MAX = 500;
/** Cap on the per-session seq watermark map. */
export const WS_SEQ_MAP_MAX = 200;
/** Recent close frames kept for the connect-error diagnostics. */
export const WS_CLOSE_LOG_MAX = 5;
/** Distinct event types kept in the WS diagnostics snapshot. */
export const WS_DEBUG_EVENT_MAX = 50;

/** Close codes that mean "re-minting a ticket will not help". */
export const WS_AUTH_CLOSE_CODES = [4401, 4403, 4408] as const;

// ── Media (src/components/media.tsx) ───────────────────────────────────────

/** Ceiling per inline-media endpoint, so a wedged server can't hang a
 *  thumbnail request forever. */
export const MEDIA_FETCH_TIMEOUT_MS = 15000;
/** Characters of a text file previewed inline. */
export const PREVIEW_MAX_CHARS = 20000;

// ── Uploads ─────────────────────────────────────────────────────────────────

/** Raw byte ceiling for a picked file. JSON base64 inflates this ~4/3. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
