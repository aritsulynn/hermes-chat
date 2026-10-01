import { connectionScope, normalizeConnectionBase } from './connection-scope';
import { DEFAULT_PROFILE } from './constants';

export { connectionScope, normalizeConnectionBase } from './connection-scope';
export { DEFAULT_PROFILE } from './constants';

// Connection + credential vault.
//
// ── What is actually sensitive here ──────────────────────────────────────────
// `localStorage` is not encrypted, so the rule is: nothing secret goes in it.
// The session cookie is never stored — the browser keeps it in its own jar
// where JS cannot read it, and this module persists only the string 'web-jar'
// as a marker so boot knows a session *might* exist and should try a silent
// reconnect. The password is never stored either: the connect pipeline calls
// `clearPassword` on every boot (see useAppStore) and gates the "remember
// password" toggle off, so the `K_PASSWORD` keys below exist only to erase
// values written by older builds.
//
// What *is* written: host, username, theme, last session, per-profile model.
// All of it is low-sensitivity, and all of it is scoped to host+username (see
// `scopedSecretKey`) so switching dashboards cannot leak one account's model
// choice or last-opened session into another.

// In-memory read-through cache. It is no longer a speed optimisation — the
// native build needed it because keychain I/O is slow, and `localStorage` is
// not. It exists because `localStorage.setItem` *throws* in some conditions
// (Safari private browsing, blocked site data, quota). The promise this file
// makes is "storage is best-effort, never fail the app over it", and that
// promise is only keepable if a value that failed to persist can still be read
// back for the rest of the session. Writes update the cache synchronously
// before the physical write is attempted; deletes evict it.
const memCache = new Map<string, string | null>();

// The native build also had to serialize writes per key, because SecureStore
// calls were async and a late cookie rotation could resolve *after* the clear
// that follows logout, resurrecting a credential. `localStorage` is
// synchronous, so writes cannot interleave and no queue is needed. The async
// signatures below stay anyway: they are the module's public contract and
// unwinding them would touch every call site for no behavioural gain.

const K_HOST = 'hermes.conn.host';
const K_USERNAME = 'hermes.conn.username';
const K_PASSWORD = 'hermes.conn.password';
const K_COOKIE = 'hermes.conn.cookie';
const K_SCOPED_SECRET_PREFIX = 'hermes.conn.secret.';
const K_THEME = 'hermes.ui.theme';
const K_ACTIVE_PROFILE = 'hermes.ui.activeProfile';
const K_LAST_SESSION = 'hermes.ui.lastSession';
const K_LAST_SESSION_PREFIX = 'hermes.ui.lastSession.profile';
const K_MODEL = 'hermes.ui.model';
const K_MODEL_PREFIX = 'hermes.ui.model.profile';
const K_MODEL_PROVIDER = 'hermes.ui.modelProvider';
const K_MODEL_PROVIDER_PREFIX = 'hermes.ui.modelProvider.profile';

/**
 * `encodeURIComponent` is the obvious choice here and is wrong: it emits `%XX`,
 * and the Android SecureStore build (the native client this module grew up in)
 * accepts only `[A-Za-z0-9._-]` in keys and throws on anything else — so every
 * scoped write silently failed and the app asked for login after each reload.
 * Hex is a strict subset of the allowed charset everywhere.
 *
 * `localStorage` would accept `encodeURIComponent` output, so this could be
 * "simplified" — don't. The web build has always written hex keys, and existing
 * users' scoped cookies/models/profiles are stored under them.
 */
function hexEncode(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    out += value.charCodeAt(i).toString(16).padStart(4, '0');
  }
  return out;
}

function scopedSecretKey(kind: 'password' | 'cookie', host: string, username: string): string {
  return `${K_SCOPED_SECRET_PREFIX}${kind}.${hexEncode(connectionScope(host, username))}`;
}

function normalizeProfile(profile: string | null | undefined): string {
  return String(profile ?? '').trim() || DEFAULT_PROFILE;
}

function profileStorageKey(prefix: string, profile: string): string {
  return `${prefix}.${hexEncode(normalizeProfile(profile))}`;
}

function accountProfileStorageKey(prefix: string, profile: string, scope: string): string {
  const normalizedScope = String(scope ?? '').trim();
  return normalizedScope
    ? `${prefix}.account.${hexEncode(normalizedScope)}.profile.${hexEncode(normalizeProfile(profile))}`
    : profileStorageKey(prefix, profile);
}

/** Persist the selected profile per dashboard account when a scope is supplied. */
export async function saveActiveProfile(profile: string, scope = ''): Promise<void> {
  if (scope) {
    await set(accountProfileStorageKey(K_ACTIVE_PROFILE, DEFAULT_PROFILE, scope), normalizeProfile(profile));
    return;
  }
  await set(K_ACTIVE_PROFILE, normalizeProfile(profile));
}

export async function getActiveProfile(scope = ''): Promise<string | null> {
  if (scope) return get(accountProfileStorageKey(K_ACTIVE_PROFILE, DEFAULT_PROFILE, scope));
  return get(K_ACTIVE_PROFILE);
}

/** Remember the session the user was viewing in each profile. */
export async function saveLastSession(id: string, profile = DEFAULT_PROFILE, scope = ''): Promise<void> {
  if (id) await set(accountProfileStorageKey(K_LAST_SESSION_PREFIX, profile, scope), id);
}

export async function getLastSession(profile = DEFAULT_PROFILE, scope = ''): Promise<string | null> {
  if (scope) return get(accountProfileStorageKey(K_LAST_SESSION_PREFIX, profile, scope));
  const scoped = await get(profileStorageKey(K_LAST_SESSION_PREFIX, profile));
  if (scoped) return scoped;
  // Migrate the pre-profile value only into the default namespace.
  return normalizeProfile(profile) === DEFAULT_PROFILE ? get(K_LAST_SESSION) : null;
}

const K_NOTIFY = 'hermes.ui.notify';

/** Remember the last picked model per profile across restarts. */
export async function saveModel(provider: string, model: string, profile = DEFAULT_PROFILE, scope = ''): Promise<void> {
  await Promise.all([
    set(accountProfileStorageKey(K_MODEL_PROVIDER_PREFIX, profile, scope), provider ?? ''),
    set(accountProfileStorageKey(K_MODEL_PREFIX, profile, scope), model ?? ''),
  ]);
}

export async function getModel(
  profile = DEFAULT_PROFILE,
  scope = '',
): Promise<{ provider: string; model: string } | null> {
  if (scope) {
    const [scopedProvider, scopedModel] = await Promise.all([
      get(accountProfileStorageKey(K_MODEL_PROVIDER_PREFIX, profile, scope)),
      get(accountProfileStorageKey(K_MODEL_PREFIX, profile, scope)),
    ]);
    return scopedModel ? { provider: scopedProvider ?? '', model: scopedModel } : null;
  }
  const [provider, model] = await Promise.all([
    get(profileStorageKey(K_MODEL_PROVIDER_PREFIX, profile)),
    get(profileStorageKey(K_MODEL_PREFIX, profile)),
  ]);
  if (model) return { provider: provider ?? '', model };
  if (normalizeProfile(profile) !== DEFAULT_PROFILE) return null;
  const [legacyProvider, legacyModel] = await Promise.all([get(K_MODEL_PROVIDER), get(K_MODEL)]);
  return legacyModel ? { provider: legacyProvider ?? '', model: legacyModel } : null;
}

export async function saveNotifyEnabled(on: boolean): Promise<void> {
  await set(K_NOTIFY, on ? '1' : '0');
}

export async function getNotifyEnabled(): Promise<boolean> {
  return (await get(K_NOTIFY)) === '1';
}

const K_KANBAN_BOARD = 'hermes.ui.kanbanBoard';

/** Remember the selected kanban board across restarts. */
export async function saveKanbanBoard(slug: string, scope = ''): Promise<void> {
  if (scope) {
    await set(`${K_KANBAN_BOARD}.account.${hexEncode(scope)}`, slug ?? '');
    return;
  }
  await set(K_KANBAN_BOARD, slug ?? '');
}

export async function getKanbanBoard(scope = ''): Promise<string | null> {
  if (scope) return get(`${K_KANBAN_BOARD}.account.${hexEncode(scope)}`);
  return get(K_KANBAN_BOARD);
}

export interface Connection {
  host: string; // e.g. http://your-server:9119
  username: string;
  hasPassword: boolean;
  hasCookie: boolean;
}

/** Reading the `localStorage` property can itself throw — a sandboxed iframe or
 *  a browser with site data disabled raises SecurityError on access, not on
 *  use — so it is never touched outside a try/catch. */
function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

async function get(key: string): Promise<string | null> {
  const cached = memCache.get(key);
  if (cached !== undefined) return cached;
  let v: string | null = null;
  try {
    v = ls()?.getItem(key) ?? null;
  } catch {
    v = null;
  }
  // Hits AND misses (null) are cached: a boot sequence probes for a password,
  // a cookie and a profile in a row, and a cached miss is what keeps that from
  // re-reading storage for keys that were never set.
  memCache.set(key, v);
  return v;
}

async function set(key: string, value: string): Promise<void> {
  // Cache first and unconditionally: if the physical write below throws, this
  // session must still behave as though it landed, which is the whole point of
  // keeping `memCache` around now that `localStorage` is fast.
  memCache.set(key, value);
  try {
    ls()?.setItem(key, value);
  } catch (e) {
    // Storage is best-effort (private mode, quota, blocked site data) — never
    // fail a login over it. But stay loud in dev: a silently-failing write is
    // exactly how the invalid SecureStore key went unnoticed on Android and
    // forced a login prompt on every single reload.
    if (import.meta.env.DEV) console.warn(`[storage] write failed for "${key}"`, e);
  }
}

async function del(key: string): Promise<void> {
  memCache.delete(key);
  try {
    ls()?.removeItem(key);
  } catch (e) {
    if (import.meta.env.DEV) console.warn(`[storage] delete failed for "${key}"`, e);
  }
}

async function resolveScope(host?: string, username?: string): Promise<{ host: string; username: string } | null> {
  const explicit = host !== undefined || username !== undefined;
  if (explicit) {
    const scopedHost = String(host ?? '').trim();
    const scopedUser = String(username ?? '').trim();
    return scopedHost && scopedUser ? { host: scopedHost, username: scopedUser } : null;
  }
  const [storedHost, storedUsername] = await Promise.all([get(K_HOST), get(K_USERNAME)]);
  const scopedHost = String(storedHost ?? '').trim();
  const scopedUser = String(storedUsername ?? '').trim();
  return scopedHost && scopedUser ? { host: scopedHost, username: scopedUser } : null;
}

/** Read a secret only from the requested dashboard/account scope. */
async function getScopedSecret(kind: 'password' | 'cookie', host?: string, username?: string): Promise<string | null> {
  const explicitScope = host !== undefined || username !== undefined;
  const scope = await resolveScope(host, username);
  if (!scope) return null;
  const scopedKey = scopedSecretKey(kind, scope.host, scope.username);
  const current = await get(scopedKey);
  if (current !== null) {
    if (!explicitScope) await del(kind === 'password' ? K_PASSWORD : K_COOKIE);
    return current;
  }

  // One-time migration for installs created before scoped credentials existed.
  // Only the implicit saved scope may migrate; an explicitly requested host
  // must never receive a legacy secret from a different dashboard.
  if (!explicitScope) {
    const legacyKey = kind === 'password' ? K_PASSWORD : K_COOKIE;
    const legacy = await get(legacyKey);
    if (legacy !== null) {
      await set(scopedKey, legacy);
      await del(legacyKey);
    }
    return legacy;
  }
  return null;
}

export async function loadConnection(): Promise<Connection> {
  const [host, username] = await Promise.all([get(K_HOST), get(K_USERNAME)]);
  const scopedHost = host ?? '';
  const scopedUsername = username ?? '';
  const [password, cookie] =
    scopedHost && scopedUsername
      ? await Promise.all([getScopedSecret('password'), getScopedSecret('cookie')])
      : [null, null];
  return {
    host: scopedHost,
    username: scopedUsername,
    hasPassword: !!password,
    hasCookie: !!cookie,
  };
}

export async function saveHost(host: string, username: string): Promise<void> {
  await Promise.all([set(K_HOST, host.trim()), set(K_USERNAME, username.trim())]);
}

export async function savePassword(password: string, host?: string, username?: string): Promise<void> {
  if (!password) return;
  const scope = await resolveScope(host, username);
  if (!scope) return;
  await set(scopedSecretKey('password', scope.host, scope.username), password);
  await del(K_PASSWORD);
}

export async function getPassword(host?: string, username?: string): Promise<string | null> {
  return getScopedSecret('password', host, username);
}

export async function saveCookie(cookie: string, host?: string, username?: string): Promise<void> {
  // The browser keeps the real cookie in its own jar and JS cannot read it, so
  // the login flow yields an empty string — persist a marker so boot knows a
  // session may exist and attempts the silent reconnect (validated via me).
  const scope = await resolveScope(host, username);
  if (!scope) return;
  const value = cookie || 'web-jar';
  const key = scopedSecretKey('cookie', scope.host, scope.username);
  if (value) await set(key, value);
  else await del(key);
  await del(K_COOKIE);
}

export async function getCookie(host?: string, username?: string): Promise<string | null> {
  return getScopedSecret('cookie', host, username);
}

export async function clearCookie(host?: string, username?: string): Promise<void> {
  const scope = await resolveScope(host, username);
  if (!scope) {
    await del(K_COOKIE);
    return;
  }
  await del(scopedSecretKey('cookie', scope.host, scope.username));
  await del(K_COOKIE);
}

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<Theme, 'system'>;

export async function getTheme(): Promise<Theme | null> {
  const v = await get(K_THEME);
  return v === 'dark' || v === 'light' || v === 'system' ? v : null;
}

export async function saveTheme(t: Theme): Promise<void> {
  await set(K_THEME, t);
}

export async function clearPassword(host?: string, username?: string): Promise<void> {
  const scope = await resolveScope(host, username);
  await del(K_PASSWORD);
  if (scope) await del(scopedSecretKey('password', scope.host, scope.username));
}

export async function forgetAll(host?: string, username?: string): Promise<void> {
  const scope = await resolveScope(host, username);
  await Promise.all([
    del(K_PASSWORD),
    del(K_COOKIE),
    ...(scope
      ? [
          del(scopedSecretKey('password', scope.host, scope.username)),
          del(scopedSecretKey('cookie', scope.host, scope.username)),
        ]
      : []),
  ]);
}
