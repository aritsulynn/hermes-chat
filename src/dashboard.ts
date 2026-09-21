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
 *  RN supports AbortController. */
async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 15000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
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
    throw new Error(`Unreachable: ${e instanceof Error ? e.message : String(e)}`);
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
  const res = await fetchWithTimeout(
    `${base}/auth/password-login`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'basic', username, password, next: '' }),
    },
    15000,
  );
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid credentials (401)');
    if (res.status === 429) throw new Error('Too many login attempts — try again shortly (429)');
    if (res.status === 404) throw new Error('Password provider not enabled on this dashboard (404)');
    throw new Error(`Login failed: HTTP ${res.status}`);
  }
  const cookies = mergeCookies('', getSetCookies(res));
  if (!cookies) throw new Error('Login ok but no session cookie was set');
  return cookies;
}

/** Step 2: mint a single-use WS ticket (must be consumed within ~30s). */
export async function mintWsTicket(baseUrl: string, cookie: string): Promise<string> {
  const base = normalizeBase(baseUrl);
  const res = await fetchWithTimeout(
    `${base}/api/auth/ws-ticket`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: '{}',
    },
    10000,
  );
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
  const err2: any = null;
  void err2;
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

// ── Model picker ────────────
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
}

export async function getModelOptions(
  baseUrl: string,
  cookie: string,
  opts: { refresh?: boolean; includeUnconfigured?: boolean } = {},
): Promise<ModelProviderOption[]> {
  const base = normalizeBase(baseUrl);
  const q = new URLSearchParams();
  if (opts.refresh) q.set('refresh', 'true');
  if (opts.includeUnconfigured) q.set('include_unconfigured', 'true');
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
  }));
}

export async function setMainModel(
  baseUrl: string,
  cookie: string,
  provider: string,
  model: string,
): Promise<void> {
  const base = normalizeBase(baseUrl);
  const res = await fetchWithTimeout(
    `${base}/api/model/set`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ scope: 'main', provider, model }),
    },
    15000,
  );
  if (!res.ok) throw new Error(`Set model failed: HTTP ${res.status}`);
}

// ── Full transcript ─────────
// GET /api/sessions/{id}/messages → full rows incl. tool RESULT content +
// reasoning sidecars. WS session.history is only a compact projection —
// this is what the native app renders (Tool cards with full JSON).
// Slashes in stored ids stay literal (backend mints ids containing '/').

export interface RestHistoryItem {
  role: string;
  content: string;
  reasoning?: string;
  name?: string;
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

export async function getSessionMessages(
  baseUrl: string,
  cookie: string,
  storedId: string,
  limit = 200,
): Promise<RestHistoryItem[]> {
  const base = normalizeBase(baseUrl);
  const path = storedId
    .split('/')
    .map((s) => encodeURIComponent(s))
    .join('/');
  const qs = new URLSearchParams({ order: 'latest', limit: String(limit) });
  const res = await fetchWithTimeout(
    `${base}/api/sessions/${path}/messages?${qs}`,
    { headers: { Cookie: cookie } },
    20000,
  );
  if (!res.ok) throw new Error(`Session messages failed: HTTP ${res.status}`);
  const body = (await res.json()) as any;
  const rows = Array.isArray(body?.messages) ? body.messages : [];
  const items: RestHistoryItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const role = String(row.role ?? '');
    if (row.display_kind === 'hidden') continue;
    const content = jsonText(row.content);
    // Model-switch / personality markers persist as role=user "[System: …]" rows.
    if (role === 'user' && content.replace(/^\s+/, '').startsWith('[System:')) continue;
    if (role === 'tool') {
      if (!content.trim()) continue;
      items.push({ role: 'tool', content, name: 'Tool' });
      continue;
    }
    const reasoning = restReasoning(row);
    if ((role === 'user' || role === 'assistant') && (content.trim() || reasoning)) {
      items.push({
        role,
        content,
        ...(reasoning ? { reasoning } : {}),
      });
    }
  }
  return items;
}
