// Dashboard REST auth — verified against hermes-agent source:
//   hermes_cli/dashboard_auth/routes.py  (POST /auth/password-login, POST /api/auth/ws-ticket)
//   hermes_cli/dashboard_auth/middleware.py (session cookie gate for /api/*)
//   hermes_cli/dashboard_auth/ws_tickets.py (TTL 30s, single-use)
//   hermes_cli/web_routers/status.py (GET /api/status: {auth_required, auth_providers})
//
// Gated mode (non-loopback bind, basic_auth) flow:
//   1. POST /auth/password-login {provider:"basic", username, password, next:""}
//      → Set-Cookie: hermes_session_at (+ rt/provider). No Authorization header.
//   2. POST /api/auth/ws-ticket {} (cookie-attached) → {ticket, ttl_seconds}
//   3. WS upgrade /api/ws?ticket=<ticket> — mint fresh per (re)connect, never reuse.
//
// The browser does have a real cookie jar, but a `Set-Cookie` from a plain-HTTP
// host on a LAN address is only kept if the request asked for it — hence the
// `credentials: 'include'` on every call below. The explicit `Cookie` header
// path is retained because `getSetCookies` is still the only way to observe
// what the gateway handed back, and because `SameSite`/`Domain` mismatches
// between an `http://192.168.x.x` host and the app's own origin are easier to
// debug when the header is visible in the request.
import { normalizeConnectionBase } from './connection-scope';
import { formatToolCommand } from '../utils/toolResult';
import { asList, asRecord } from '../utils/ops';
import {
  DEFAULT_PROFILE,
  HTTP_API_TIMEOUT_MS,
  HTTP_LOGIN_TIMEOUT_MS,
  HTTP_LOGOUT_TIMEOUT_MS,
  HTTP_MODEL_OPTIONS_TIMEOUT_MS,
  HTTP_PROBE_TIMEOUT_MS,
  HTTP_SESSION_CHECK_TIMEOUT_MS,
  HTTP_SESSION_MESSAGES_TIMEOUT_MS,
  HTTP_TICKET_TIMEOUT_MS,
  HTTP_TIMEOUT_MS,
  SESSION_MESSAGES_CACHE_MAX,
  SESSION_MESSAGES_LIMIT,
  SESSION_MESSAGES_TTL_MS,
} from './constants';
import * as api from './api';

export type AuthMode = 'basic' | 'token' | 'unreachable';

export interface ProbeResult {
  authRequired: boolean;
  providers: string[];
}

export function normalizeBase(baseUrl: string): string {
  const raw = baseUrl.trim();
  if (!raw) return '';
  const normalized = normalizeConnectionBase(raw);
  if (!normalized) throw new Error('Dashboard URL userinfo is not allowed');
  return normalized;
}

/** fetch with a hard timeout so the UI never hangs forever on an
 *  unreachable host (wrong WiFi / changed LAN IP / dashboard down).
 *  `credentials: include` lets the session cookie flow once the dashboard
 *  CORS-allows our origin (a no-op for same-origin). */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = HTTP_TIMEOUT_MS): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    // no-store: a cached /api/status hit would fake a passing probe while
    // the network is actually down, sending POSTs into a raw TypeError.
    return await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      // Never follow an authenticated redirect to another origin with the
      // dashboard Cookie header. Callers can opt out explicitly if needed.
      redirect: 'manual',
      ...init,
      signal: ctrl.signal,
    });
  } catch (e: unknown) {
    if (e && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError')
      throw new Error(`Request timed out (${ms / 1000}s): ${url}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse Set-Cookie response headers into a `name=value; ...` Cookie string. */
export function mergeCookies(prev: string, setCookieHeaders: string[]): string {
  const jar = new Map<string, string>();
  for (const pair of prev.split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  for (const h of setCookieHeaders) {
    const semi = h.indexOf(';');
    const pair = semi >= 0 ? h.slice(0, semi) : h;
    const i = pair.indexOf('=');
    if (i > 0) {
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      // Expired/cleared cookies come back empty — drop them.
      if (!value) jar.delete(name);
      else jar.set(name, value);
    }
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Collect every Set-Cookie value from a fetch Response (covers the runtime shapes browsers expose). */
export function getSetCookies(res: Response): string[] {
  const out: string[] = [];
  try {
    const hdrs = (res as unknown as { headers?: unknown }).headers as
      | {
          getSetCookie?: () => unknown;
          raw?: () => Record<string, string[] | undefined>;
          get?: (name: string) => string | null;
        }
      | undefined;
    if (typeof hdrs?.getSetCookie === 'function') {
      for (const c of asList(hdrs.getSetCookie())) out.push(String(c));
    } else if (typeof hdrs?.raw === 'function') {
      for (const c of hdrs.raw()['set-cookie'] ?? []) out.push(String(c));
    } else {
      const single = hdrs?.get?.('set-cookie');
      if (single) out.push(...String(single).split(/,(?=[^;,]+=[^;,]*)/));
    }
  } catch (e) {
    console.warn('[dashboard] getSetCookies failed', e);
  }
  return out;
}

export async function probeStatus(baseUrl: string): Promise<ProbeResult> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}${api.status()}`, {}, HTTP_PROBE_TIMEOUT_MS);
  } catch (e) {
    // The browser hides the reason (CORS vs TCP) behind a bare TypeError. A
    // no-cors probe tells them apart: an opaque response means the host is
    // reachable and it is the dashboard's CORS policy that refused us.
    try {
      const probe = await fetchWithTimeout(
        `${base}${api.status()}`,
        { mode: 'no-cors' } as RequestInit,
        HTTP_PROBE_TIMEOUT_MS,
      );
      if (asRecord(probe).type === 'opaque') {
        throw new Error(
          "Dashboard reachable but the browser blocked the request (CORS) — this client's origin has to be allowed on the dashboard",
        );
      }
    } catch (e2) {
      if (e2 instanceof Error && /CORS/.test(e2.message)) throw e2;
    }
    // No CLEARTEXT branch any more: that was Android's network-security policy
    // rejecting plain HTTP, and a browser has no equivalent. A plain-HTTP
    // gateway on a LAN address is reachable from here as-is.
    const raw = e instanceof Error ? e.message : String(e);
    throw new Error(`Unreachable: ${raw}`);
  }
  if (!res.ok) throw new Error(`Dashboard probe failed: HTTP ${res.status}`);
  const body = asRecord(await res.json());
  return {
    authRequired: body.auth_required === true,
    providers: Array.isArray(body.auth_providers) ? body.auth_providers.map(String) : [],
  };
}

/** Step 1: password login → session cookie string. Throws with server message. */
export async function passwordLogin(baseUrl: string, username: string, password: string): Promise<string> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}${api.passwordLogin()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'basic',
          username,
          password,
          next: '',
        }),
      },
      HTTP_LOGIN_TIMEOUT_MS,
    );
  } catch (e) {
    throw new Error(`Login request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid credentials (401)');
    if (res.status === 429) throw new Error('Too many login attempts — try again shortly (429)');
    if (res.status === 404) throw new Error('Password provider not enabled on this dashboard (404)');
    throw new Error(`Login failed: HTTP ${res.status}`);
  }
  // The browser hides Set-Cookie from JS (it is a forbidden header) but stores
  // it in the built-in jar, and subsequent `credentials: 'include'` requests
  // carry it automatically. So an empty string here is the *expected* web
  // result, not a failure — `saveCookie` turns it into a 'web-jar' marker and
  // boot validates the session against `me`.
  return mergeCookies('', getSetCookies(res));
}

/** Step 2: mint a single-use WS ticket (must be consumed within ~30s). */
export async function mintWsTicket(
  baseUrl: string,
  cookie: string,
  onCookie?: (nextCookie: string) => void,
): Promise<string> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}${api.wsTicket()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}',
      },
      HTTP_TICKET_TIMEOUT_MS,
    );
  } catch (e) {
    throw new Error(`Ticket request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Cookie may have rotated — caller should merge any Set-Cookie it carries.
  const rotated = mergeCookies(cookie, getSetCookies(res));
  if (rotated !== cookie) onCookie?.(rotated);
  if (!res.ok) {
    const err = new Error(`WS ticket mint failed: HTTP ${res.status}`) as Error & {
      status?: number;
      cookie?: string;
    };
    err.status = res.status;
    err.cookie = rotated !== cookie ? rotated : undefined;
    throw err;
  }
  const body = asRecord(await res.json());
  const ticket = typeof body.ticket === 'string' ? body.ticket : '';
  if (!ticket) throw new Error('WS ticket response had no ticket');
  return ticket;
}

type CookieUpdater = (nextCookie: string) => void | Promise<void>;

async function fetchAuthed(
  url: string,
  init: RequestInit,
  cookie: string,
  ms: number,
  onCookie?: CookieUpdater,
): Promise<Response> {
  const res = await fetchWithTimeout(url, init, ms);
  const rotated = mergeCookies(cookie, getSetCookies(res));
  if (rotated !== cookie) await onCookie?.(rotated);
  return res;
}

/** Optional: verify the session cookie still works. */
export async function checkMe(baseUrl: string, cookie: string, onCookie?: CookieUpdater): Promise<boolean> {
  const base = normalizeBase(baseUrl);
  try {
    const res = await fetchAuthed(
      `${base}${api.authMe()}`,
      { headers: { Cookie: cookie } },
      cookie,
      HTTP_SESSION_CHECK_TIMEOUT_MS,
      onCookie,
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Best-effort server-side logout; local cleanup must continue if this fails. */
export async function logoutDashboard(baseUrl: string, cookie: string): Promise<void> {
  const base = normalizeBase(baseUrl);
  if (!base) return;
  try {
    await fetchWithTimeout(
      `${base}${api.logout()}`,
      {
        method: 'POST',
        ...(cookie ? { headers: { Cookie: cookie } } : {}),
        redirect: 'manual',
      },
      HTTP_LOGOUT_TIMEOUT_MS,
    );
  } catch {
    // Logout is still completed locally when the dashboard is unreachable.
  }
}

export function toWsUrl(baseUrl: string, ticket: string): string {
  const base = normalizeBase(baseUrl);
  const ws = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${ws}${api.ws(ticket)}`;
}

// ── Model picker ─────────────────────────────────────────────────────────
// GET /api/model/options → {providers:[{slug,name,is_current,models,total_models,...}]}
// POST /api/model/set {scope:"main",provider,model} — global default.
// NOTE: "this chat" switching goes through WS command.dispatch (/model),
// this REST setter is the global fallback.

export interface ModelProviderOption {
  slug: string;
  name: string;
  isCurrent?: boolean;
  models: string[] | null;
  totalModels: number;
  authenticated?: boolean;
  /** Per-model capability rows (`hermes_cli/inventory.py::_apply_capabilities`) —
   *  `{model: {fast, reasoning, can_disable_reasoning?}}`. Missing on old gateways. */
  capabilities?: Record<
    string,
    {
      fast?: boolean;
      reasoning?: boolean;
      can_disable_reasoning?: boolean | null;
    }
  > | null;
}

/** Narrow the opaque `capabilities` map down to the documented per-model shape
 *  (`utils/reasoning.ts` reads exactly these three fields). Unknown keys and
 *  wrong-typed values are dropped rather than cast through. */
function capabilityRows(value: unknown): ModelProviderOption['capabilities'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: NonNullable<ModelProviderOption['capabilities']> = {};
  for (const [model, raw] of Object.entries(value)) {
    const cap = asRecord(raw);
    const row: { fast?: boolean; reasoning?: boolean; can_disable_reasoning?: boolean | null } = {};
    if (typeof cap.fast === 'boolean') row.fast = cap.fast;
    if (typeof cap.reasoning === 'boolean') row.reasoning = cap.reasoning;
    if (typeof cap.can_disable_reasoning === 'boolean') {
      row.can_disable_reasoning = cap.can_disable_reasoning;
    } else if (cap.can_disable_reasoning === null) {
      row.can_disable_reasoning = null;
    }
    out[model] = row;
  }
  return out;
}

export async function getModelOptions(
  baseUrl: string,
  cookie: string,
  opts: {
    refresh?: boolean;
    includeUnconfigured?: boolean;
    profile?: string;
  } = {},
  onCookie?: CookieUpdater,
): Promise<ModelProviderOption[]> {
  const base = normalizeBase(baseUrl);
  const res = await fetchAuthed(
    `${base}${api.modelOptions(opts)}`,
    { headers: { Cookie: cookie } },
    cookie,
    HTTP_MODEL_OPTIONS_TIMEOUT_MS,
    onCookie,
  );
  if (!res.ok) throw new Error(`Model options failed: HTTP ${res.status}`);
  const body = asRecord(await res.json());
  const rows = Array.isArray(body.providers) ? body.providers : [];
  return rows.map((p) => {
    const row = asRecord(p);
    const models = Array.isArray(row.models) ? row.models.map(String) : null;
    const capabilities = capabilityRows(row.capabilities);
    return {
      slug: String(row.slug ?? ''),
      name: String(row.name ?? row.slug ?? ''),
      ...(typeof row.is_current === 'boolean' ? { isCurrent: row.is_current } : {}),
      models,
      totalModels: Number(row.total_models ?? (models ? models.length : 0)),
      ...(typeof row.authenticated === 'boolean' ? { authenticated: row.authenticated } : {}),
      ...(capabilities ? { capabilities } : {}),
    };
  });
}

export async function setMainModel(
  baseUrl: string,
  cookie: string,
  provider: string,
  model: string,
  profile?: string,
  onCookie?: CookieUpdater,
): Promise<void> {
  const base = normalizeBase(baseUrl);
  const res = await fetchAuthed(
    `${base}${api.modelSet(profile)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ scope: 'main', provider, model }),
    },
    cookie,
    HTTP_MODEL_OPTIONS_TIMEOUT_MS,
    onCookie,
  );
  if (!res.ok) throw new Error(`Set model failed: HTTP ${res.status}`);
}

// ── Generic authed REST helper (ops screens) ─────────────────────────────
// Cookie auth, NO Authorization header (dashboard 401s it in gated mode).

export async function apiGet(
  baseUrl: string,
  cookie: string,
  path: string,
  onCookie?: CookieUpdater,
): Promise<unknown> {
  const base = normalizeBase(baseUrl);
  const res = await fetchAuthed(
    `${base}${path}`,
    { headers: { Cookie: cookie } },
    cookie,
    HTTP_API_TIMEOUT_MS,
    onCookie,
  );
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  try {
    return (await res.json()) as unknown;
  } catch (e) {
    console.warn(`[dashboard] GET ${path} returned non-JSON`, e);
    return null;
  }
}

export async function apiMut(
  baseUrl: string,
  cookie: string,
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  onCookie?: CookieUpdater,
): Promise<unknown> {
  const base = normalizeBase(baseUrl);
  const res = await fetchAuthed(
    `${base}${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    cookie,
    HTTP_API_TIMEOUT_MS,
    onCookie,
  );
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json()).slice(0, 200);
    } catch (e) {
      console.warn(`[dashboard] ${method} ${path} error body was non-JSON`, e);
    }
    throw new Error(`${method} ${path} → HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
  }
  try {
    const t = await res.text();
    return t ? (JSON.parse(t) as unknown) : null;
  } catch (e) {
    console.warn(`[dashboard] ${method} ${path} returned non-JSON`, e);
    return null;
  }
}

// Ops endpoints (route shapes per the hermes-agent dashboard API;
// all best-effort — screens degrade to an error line).

export const opsGet = apiGet;
export const opsMut = apiMut;

// ── Full transcript ──────────────────────────────────────────────────────
// GET /api/sessions/{id}/messages → full rows incl. tool RESULT content +
// reasoning sidecars. WS session.history is only a compact projection —
// this is the full payload the UI renders (tool cards with full JSON).
// Slashes in stored ids stay literal (backend mints ids containing '/').

export interface RestHistoryItem {
  role: string;
  content: string;
  reasoning?: string;
  name?: string;
  /** The tool's command / primary arg, joined from the assistant tool_calls. */
  command?: string;
  /** Durable DB row id (user/assistant rows) — the rewind/edit target. */
  rowId?: number;
  /** Authoring time (Unix seconds). */
  ts?: number;
  /**
   * Gateway render hint. `failed_turn` marks a Hermes-authored boundary row
   * that closes a turn which ended without an answer — NOT the model speaking
   * (see `agent/turn_failure_copy.py`). The desktop projects it to a system
   * row; without the flag the notice renders as if the bot had said it.
   */
  displayKind?: string;
}

function jsonText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function restReasoning(row: Record<string, unknown>): string {
  const out: string[] = [];
  for (const k of ['reasoning', 'reasoning_text']) {
    const t = jsonText(row[k]);
    if (t.trim()) out.push(t);
  }
  const det = row.reasoning_details;
  if (Array.isArray(det)) {
    for (const d of det) {
      if (typeof d === 'string') {
        if (d.trim()) out.push(d);
      } else if (d && typeof d === 'object') {
        const o = d as Record<string, unknown>;
        for (const k of ['text', 'content', 'summary']) {
          if (typeof o[k] === 'string' && (o[k] as string).trim()) {
            out.push(o[k] as string);
            break;
          }
        }
      }
    }
  }
  const seen = new Set<string>();
  return out
    .filter((p) => {
      if (seen.has(p)) return false;
      seen.add(p);
      return true;
    })
    .join('\n')
    .trim();
}

const sessionMessagesCache = new Map<string, { at: number; items: RestHistoryItem[] }>();

export function clearSessionMessagesCache(): void {
  sessionMessagesCache.clear();
}

export async function getSessionMessages(
  baseUrl: string,
  cookie: string,
  storedId: string,
  profileOrLimit: string | number = DEFAULT_PROFILE,
  limit = SESSION_MESSAGES_LIMIT,
  accountScope = '',
  onCookie?: CookieUpdater,
): Promise<RestHistoryItem[]> {
  // The numeric fourth argument remains accepted for older callers.
  const selectedProfile =
    (typeof profileOrLimit === 'number' ? DEFAULT_PROFILE : String(profileOrLimit ?? '')).trim() || DEFAULT_PROFILE;
  const selectedLimit = typeof profileOrLimit === 'number' ? profileOrLimit : limit;
  // Short in-memory TTL — toolRefresh + stampRowIds + resync often fire
  // back-to-back for the same session and each refetches 200 rows.
  const cacheKey = JSON.stringify([
    normalizeBase(baseUrl),
    accountScope || cookie,
    selectedProfile,
    storedId,
    selectedLimit,
  ]);
  const now = Date.now();
  const hit = sessionMessagesCache.get(cacheKey);
  if (hit && now - hit.at < SESSION_MESSAGES_TTL_MS) return hit.items;
  const base = normalizeBase(baseUrl);
  const res = await fetchAuthed(
    `${base}${api.sessionMessages(storedId, { limit: selectedLimit, profile: selectedProfile })}`,
    cookie ? { headers: { Cookie: cookie } } : {},
    cookie,
    HTTP_SESSION_MESSAGES_TIMEOUT_MS,
    onCookie,
  );
  if (!res.ok) throw new Error(`Session messages failed: HTTP ${res.status}`);
  const body = asRecord(await res.json());
  const rows = Array.isArray(body.messages) ? body.messages : [];
  const items: RestHistoryItem[] = [];
  // Assistant tool_calls carry the args; join them to the tool row by id so the
  // bubble can show the command above its result (history has no other copy).
  const toolArgs = new Map<string, unknown>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const role = String(rec.role ?? '');
    if (role === 'assistant' && Array.isArray(rec.tool_calls)) {
      for (const tc of rec.tool_calls) {
        const call = asRecord(tc);
        const id = typeof call.id === 'string' ? call.id : '';
        if (!id) continue;
        const fn = asRecord(call.function);
        let a: unknown = fn.arguments;
        if (typeof a === 'string') {
          try {
            a = JSON.parse(a) as unknown;
          } catch (e) {
            console.warn('[dashboard] tool_call arguments were non-JSON', e);
            a = { command: a };
          }
        }
        toolArgs.set(id, a);
      }
    }
    if (rec.display_kind === 'hidden') continue;
    const displayKind = typeof rec.display_kind === 'string' ? rec.display_kind : undefined;
    const content = jsonText(rec.content);
    // Model-switch / personality markers persist as role=user "[System: …]" rows.
    if (role === 'user' && content.replace(/^\s+/, '').startsWith('[System:')) continue;
    if (role === 'tool') {
      if (!content.trim()) continue;
      const command =
        formatToolCommand(toolArgs.get(String(rec.tool_call_id ?? ''))) ||
        (typeof rec.context === 'string' ? rec.context : '');
      items.push({
        role: 'tool',
        content,
        name: String(rec.name ?? rec.tool_name ?? 'Tool'),
        ...(command ? { command } : {}),
      });
      continue;
    }
    const reasoning = restReasoning(rec);
    if ((role === 'user' || role === 'assistant') && (content.trim() || reasoning)) {
      items.push({
        role,
        content,
        ...(reasoning ? { reasoning } : {}),
        ...(typeof rec.id === 'number' ? { rowId: rec.id } : {}),
        ...(typeof rec.timestamp === 'number' ? { ts: rec.timestamp } : {}),
        ...(displayKind ? { displayKind } : {}),
      });
    }
  }
  if (sessionMessagesCache.size > SESSION_MESSAGES_CACHE_MAX) {
    const oldest = sessionMessagesCache.keys().next().value;
    if (oldest !== undefined) sessionMessagesCache.delete(oldest);
  }
  sessionMessagesCache.set(cacheKey, { at: now, items });
  return items;
}
