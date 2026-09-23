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
// RN fetch/XHR has no shared cookie jar on all platforms the way OkHttp does,
// so this module keeps `Cookie` headers explicitly and passes them per request.
import { Platform } from 'react-native';
import { formatToolCommand } from '../utils/toolResult';

export type AuthMode = 'basic' | 'token' | 'unreachable';

export interface ProbeResult {
  authRequired: boolean;
  providers: string[];
}

export function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** fetch with a hard timeout so the UI never hangs forever on an
 *  unreachable host (wrong WiFi / changed LAN IP / dashboard down).
 *  RN supports AbortController. `credentials: include` lets the session
 *  cookie flow on web once the dashboard CORS-allows our origin
 *  (no-op for same-origin and native). */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    // no-store: a cached /api/status hit would fake a passing probe while
    // the network is actually down, sending POSTs into a raw TypeError.
    return await fetch(url, { credentials: 'include', cache: 'no-store', ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Request timed out (${ms / 1000}s): ${url}`);
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

/** Collect every Set-Cookie value from a fetch Response (RN/undici/web shapes). */
export function getSetCookies(res: Response): string[] {
  const out: string[] = [];
  try {
    const hdrs: any = (res as any).headers;
    if (typeof hdrs?.getSetCookie === 'function') {
      for (const c of hdrs.getSetCookie()) out.push(String(c));
    } else if (typeof hdrs?.raw === 'function') {
      for (const c of hdrs.raw()['set-cookie'] ?? []) out.push(String(c));
    } else {
      const single = hdrs?.get?.('set-cookie');
      if (single) out.push(...String(single).split(/,(?=[^;,]+=[^;,]*)/));
    }
  } catch {}
  return out;
}

export async function probeStatus(baseUrl: string): Promise<ProbeResult> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/status`, {}, 8000);
  } catch (e) {
    // Browsers hide the reason (CORS vs TCP) behind TypeError. A no-cors
    // probe distinguishes them: opaque response = reachable but CORS-blocked.
    if (Platform.OS === 'web') {
      try {
        const probe = await fetchWithTimeout(`${base}/api/status`, { mode: 'no-cors' } as RequestInit, 8000);
        if ((probe as any)?.type === 'opaque') {
          throw new Error(
            'Dashboard reachable but the browser blocked the request (CORS) — allow this origin on the dashboard, or use the Expo Go native app instead',
          );
        }
      } catch (e2) {
        if (e2 instanceof Error && /CORS/.test(e2.message)) throw e2;
      }
    }
    const raw = e instanceof Error ? e.message : String(e);
    // Stale native shell (built before the cleartext config) surfaces as a
    // CLEARTEXT policy rejection — tell the user it's the app build, not the
    // server, and that only a fresh native build fixes it (OTA can't).
    if (/CLEARTEXT/i.test(raw)) {
      throw new Error(
        `Android blocked plain-HTTP to this host (CLEARTEXT policy). This build is too old — rebuild the native APK after the network-security fix and reinstall, then retry. Detail: ${raw}`,
      );
    }
    throw new Error(`Unreachable: ${raw}`);
  }
  if (!res.ok) throw new Error(`Dashboard probe failed: HTTP ${res.status}`);
  const body = (await res.json()) as any;
  return {
    authRequired: body?.auth_required === true,
    providers: Array.isArray(body?.auth_providers)
      ? body.auth_providers.map(String)
      : [],
  };
}

/** Step 1: password login → session cookie string. Throws with server message. */
export async function passwordLogin(
  baseUrl: string,
  username: string,
  password: string,
): Promise<string> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/auth/password-login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'basic', username, password, next: '' }),
      },
      15000,
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
  const cookies = mergeCookies('', getSetCookies(res));
  // Web browsers hide Set-Cookie from JS (forbidden header) but store it in
  // the built-in jar — subsequent credentials:include requests carry it
  // automatically. Only native needs the explicit cookie string.
  if (!cookies && Platform.OS !== 'web') throw new Error('Login ok but no session cookie was set');
  return cookies;
}

/** Step 2: mint a single-use WS ticket (must be consumed within ~30s). */
export async function mintWsTicket(baseUrl: string, cookie: string): Promise<string> {
  const base = normalizeBase(baseUrl);
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/auth/ws-ticket`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: '{}',
      },
      10000,
    );
  } catch (e) {
    throw new Error(`Ticket request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Cookie may have rotated — caller should merge any Set-Cookie it carries.
  const rotated = mergeCookies(cookie, getSetCookies(res));
  if (!res.ok) {
    const err: any = new Error(`WS ticket mint failed: HTTP ${res.status}`);
    err.cookie = rotated !== cookie ? rotated : undefined;
    throw err;
  }
  const body = (await res.json()) as any;
  const ticket = typeof body?.ticket === 'string' ? body.ticket : '';
  if (!ticket) throw new Error('WS ticket response had no ticket');
  return ticket;
}

/** Optional: verify the session cookie still works. */
export async function checkMe(baseUrl: string, cookie: string): Promise<boolean> {
  const base = normalizeBase(baseUrl);
  try {
    const res = await fetchWithTimeout(`${base}/api/auth/me`, { headers: { Cookie: cookie } }, 8000);
    return res.ok;
  } catch {
    return false;
  }
}

export function toWsUrl(baseUrl: string, ticket: string): string {
  const base = normalizeBase(baseUrl);
  const ws = base.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
  return `${ws}/api/ws?ticket=${encodeURIComponent(ticket)}`;
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
  capabilities?: Record<string, { fast?: boolean; reasoning?: boolean; can_disable_reasoning?: boolean | null }> | null;
}

export interface ProfileSummary {
  name: string;
  display_name?: string;
  description?: string;
  model?: string | null;
  provider?: string | null;
  is_default?: boolean;
  gateway_running?: boolean;
  [key: string]: unknown;
}

function profileRows(payload: unknown): ProfileSummary[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as any)?.profiles)
      ? (payload as any).profiles
      : [];
  return rows
    .filter((row: any) => row && typeof row === 'object' && typeof row.name === 'string' && row.name.trim())
    .map((row: any) => ({ ...row, name: String(row.name).trim() }));
}

export async function getProfiles(baseUrl: string, cookie: string): Promise<ProfileSummary[]> {
  const base = normalizeBase(baseUrl);
  const res = await fetchWithTimeout(
    `${base}/api/profiles`,
    cookie ? { headers: { Cookie: cookie } } : {},
    20000,
  );
  if (!res.ok) throw new Error(`Profiles failed: HTTP ${res.status}`);
  return profileRows(await res.json());
}

export async function getCurrentProfile(
  baseUrl: string,
  cookie: string,
): Promise<{ active: string; current: string }> {
  const base = normalizeBase(baseUrl);
  const res = await fetchWithTimeout(
    `${base}/api/profiles/active`,
    cookie ? { headers: { Cookie: cookie } } : {},
    20000,
  );
  if (!res.ok) throw new Error(`Active profile failed: HTTP ${res.status}`);
  const body: any = await res.json();
  return {
    active: typeof body?.active === 'string' && body.active.trim() ? body.active.trim() : 'default',
    current: typeof body?.current === 'string' && body.current.trim() ? body.current.trim() : 'default',
  };
}

export async function getModelOptions(
  baseUrl: string,
  cookie: string,
  opts: { refresh?: boolean; includeUnconfigured?: boolean; profile?: string } = {},
): Promise<ModelProviderOption[]> {
  const base = normalizeBase(baseUrl);
  const q = new URLSearchParams();
  if (opts.refresh) q.set('refresh', 'true');
  if (opts.includeUnconfigured) q.set('include_unconfigured', 'true');
  const profile = String(opts.profile ?? '').trim();
  if (profile) q.set('profile', profile);
  const qs = q.toString() ? `?${q}` : '';
  const res = await fetchWithTimeout(`${base}/api/model/options${qs}`, { headers: { Cookie: cookie } }, 15000);
  if (!res.ok) throw new Error(`Model options failed: HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const rows = Array.isArray(body?.providers) ? body.providers : [];
  return rows.map((p: any) => ({
    slug: String(p?.slug ?? ''),
    name: String(p?.name ?? p?.slug ?? ''),
    ...(typeof p?.is_current === 'boolean' ? { isCurrent: p.is_current } : {}),
    models: Array.isArray(p?.models) ? p.models.map(String) : null,
    totalModels: Number(p?.total_models ?? (Array.isArray(p?.models) ? p.models.length : 0)),
    ...(typeof p?.authenticated === 'boolean' ? { authenticated: p.authenticated } : {}),
    ...(p?.capabilities && typeof p.capabilities === 'object' ? { capabilities: p.capabilities } : {}),
  }));
}

export async function setMainModel(
  baseUrl: string,
  cookie: string,
  provider: string,
  model: string,
  profile?: string,
): Promise<void> {
  const base = normalizeBase(baseUrl);
  const selectedProfile = String(profile ?? '').trim();
  const query = selectedProfile ? `?profile=${encodeURIComponent(selectedProfile)}` : '';
  const res = await fetchWithTimeout(
    `${base}/api/model/set${query}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ scope: 'main', provider, model }),
    },
    15000,
  );
  if (!res.ok) throw new Error(`Set model failed: HTTP ${res.status}`);
}

// ── Generic authed REST helper (ops screens) ─────────────────────────────
// Cookie auth, NO Authorization header (dashboard 401s it in gated mode).

export async function apiGet(baseUrl: string, cookie: string, path: string): Promise<any> {
  const base = normalizeBase(baseUrl);
  const res = await fetchWithTimeout(`${base}${path}`, { headers: { Cookie: cookie } }, 20000);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function apiMut(
  baseUrl: string,
  cookie: string,
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<any> {
  const base = normalizeBase(baseUrl);
  const res = await fetchWithTimeout(
    `${base}${path}`,
    {
      method,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    20000,
  );
  if (!res.ok) {
    let detail = '';
    try {
      detail = JSON.stringify(await res.json()).slice(0, 200);
    } catch {}
    throw new Error(`${method} ${path} → HTTP ${res.status}${detail ? ` ${detail}` : ''}`);
  }
  try {
    const t = await res.text();
    return t ? JSON.parse(t) : null;
  } catch {
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
// this is what the native app renders (Tool cards with full JSON).
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

export async function getSessionMessages(
  baseUrl: string,
  cookie: string,
  storedId: string,
  profileOrLimit: string | number = 'default',
  limit = 200,
): Promise<RestHistoryItem[]> {
  // The numeric fourth argument remains accepted for older callers.
  const selectedProfile = (
    typeof profileOrLimit === 'number' ? 'default' : String(profileOrLimit ?? '')
  ).trim() || 'default';
  const selectedLimit = typeof profileOrLimit === 'number' ? profileOrLimit : limit;
  // 5s in-memory TTL — toolRefresh + stampRowIds + resync often fire
  // back-to-back for the same session and each refetches 200 rows.
  const cacheKey = `${normalizeBase(baseUrl)}|${selectedProfile}|${storedId}|${selectedLimit}`;
  const now = Date.now();
  const hit = sessionMessagesCache.get(cacheKey);
  if (hit && now - hit.at < 5000) return hit.items;
  const base = normalizeBase(baseUrl);
  const path = storedId
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const qs = new URLSearchParams({
    order: 'latest',
    limit: String(selectedLimit),
    profile: selectedProfile,
  });
  const res = await fetchWithTimeout(
    `${base}/api/sessions/${path}/messages?${qs}`,
    cookie ? { headers: { Cookie: cookie } } : {},
    20000,
  );
  if (!res.ok) throw new Error(`Session messages failed: HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const rows = Array.isArray(body?.messages) ? body.messages : [];
  const items: RestHistoryItem[] = [];
  // Assistant tool_calls carry the args; join them to the tool row by id so the
  // bubble can show the command above its result (history has no other copy).
  const toolArgs = new Map<string, unknown>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const role = String(row.role ?? '');
    if (role === 'assistant' && Array.isArray((row as any).tool_calls)) {
      for (const tc of (row as any).tool_calls) {
        const id = typeof tc?.id === 'string' ? tc.id : '';
        if (!id) continue;
        const fn = (tc?.function ?? {}) as any;
        let a: unknown = fn?.arguments;
        if (typeof a === 'string') {
          try {
            a = JSON.parse(a);
          } catch {
            a = { command: a };
          }
        }
        toolArgs.set(id, a);
      }
    }
    if (row.display_kind === 'hidden') continue;
    const content = jsonText(row.content);
    // Model-switch / personality markers persist as role=user "[System: …]" rows.
    if (role === 'user' && content.replace(/^\s+/, '').startsWith('[System:')) continue;
    if (role === 'tool') {
      if (!content.trim()) continue;
      const command =
        formatToolCommand(toolArgs.get(String((row as any).tool_call_id ?? ''))) ||
        (typeof (row as any).context === 'string' ? (row as any).context : '');
      items.push({
        role: 'tool',
        content,
        name: String((row as any).name ?? (row as any).tool_name ?? 'Tool'),
        ...(command ? { command } : {}),
      });
      continue;
    }
    const reasoning = restReasoning(row);
    if ((role === 'user' || role === 'assistant') && (content.trim() || reasoning)) {
      items.push({
        role,
        content,
        ...(reasoning ? { reasoning } : {}),
        ...(typeof (row as any).id === 'number' ? { rowId: (row as any).id as number } : {}),
        ...(typeof (row as any).timestamp === 'number' ? { ts: (row as any).timestamp as number } : {}),
      });
    }
  }
  if (sessionMessagesCache.size > 20) {
    const oldest = sessionMessagesCache.keys().next().value;
    if (oldest !== undefined) sessionMessagesCache.delete(oldest);
  }
  sessionMessagesCache.set(cacheKey, { at: now, items });
  return items;
}
