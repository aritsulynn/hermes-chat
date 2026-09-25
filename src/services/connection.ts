import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { connectionScope, normalizeConnectionBase } from './connection-scope';
import { DEFAULT_PROFILE } from './constants';

export { connectionScope, normalizeConnectionBase } from './connection-scope';
export { DEFAULT_PROFILE } from './constants';

// Connection + credential vault. Secrets (password, session cookie) live in
// SecureStore (encrypted at rest). Non-secrets (host, username) live in
// AsyncStorage-equivalent plain storage — here also SecureStore for simplicity,
// keyed separately so a "forget password" can wipe just the secret.
//
// Web has no SecureStore — fall back to AsyncStorage (localStorage).
// Note: web storage is NOT encrypted; native stays in the OS keychain.
const useWebStore = Platform.OS === 'web';

// In-memory read-through cache: SecureStore = keychain I/O, slow. Boot reads
// host/user/pw/cookie/theme/model back-to-back — cache so repeats are free.
// Writes update the cache synchronously; deletes evict it.
const memCache = new Map<string, string | null>();
// Serialize physical writes per key. A late cookie rotation must not win over
// the clear that follows logout, even when SecureStore calls resolve out of order.
const storageTails = new Map<string, Promise<void>>();

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
 * SecureStore (Android) only accepts `[A-Za-z0-9._-]` in keys and throws on
 * anything else (expo-secure-store build/SecureStore.js — "Invalid key").
 * `encodeURIComponent` emits `%XX`, which is invalid, so every scoped write
 * (cookie, password, profile, model, session, board) silently failed on
 * Android and the app asked for login again after each reload.
 * Hex is a strict subset of the allowed charset on every platform.
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

async function get(key: string): Promise<string | null> {
  try {
    const cached = memCache.get(key);
    if (cached !== undefined) return cached;
    const pending = storageTails.get(key);
    if (pending) await pending;
    const afterWrite = memCache.get(key);
    if (afterWrite !== undefined) return afterWrite;
    const v = useWebStore ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
    // Cache hits AND misses (null) so repeat boot reads don't hit keychain again.
    // Miss cache is short-lived to avoid stale first-run writes.
    memCache.set(key, v);
    return v;
  } catch {
    return memCache.get(key) ?? null;
  }
}

function queueStorageWrite(key: string, write: () => Promise<void>): Promise<void> {
  const previous = storageTails.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      try {
        await write();
      } catch (e) {
        // Storage is best-effort (e.g. private mode) — never fail login over it.
        // But stay loud in dev: a silently-failing write is how the invalid
        // SecureStore key went unnoticed and forced a login on every reload.
        if (__DEV__) console.warn(`[storage] write failed for "${key}"`, e);
      }
    });
  storageTails.set(key, current);
  void current.finally(() => {
    if (storageTails.get(key) === current) storageTails.delete(key);
  });
  return current;
}

async function set(key: string, value: string): Promise<void> {
  memCache.set(key, value);
  await queueStorageWrite(key, async () => {
    if (useWebStore) {
      await AsyncStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  });
}

async function del(key: string): Promise<void> {
  memCache.delete(key);
  await queueStorageWrite(key, async () => {
    if (useWebStore) await AsyncStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  });
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
  // Web keeps the real cookie in the browser jar (JS can't see it) and the
  // login flow yields an empty string — persist a marker so boot knows a
  // session may exist and attempts the silent reconnect (validated via me).
  const scope = await resolveScope(host, username);
  if (!scope) return;
  const value = useWebStore ? cookie || 'web-jar' : cookie;
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
