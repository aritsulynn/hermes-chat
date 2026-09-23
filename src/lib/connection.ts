import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

const K_HOST = 'hermes.conn.host';
const K_USERNAME = 'hermes.conn.username';
const K_PASSWORD = 'hermes.conn.password';
const K_COOKIE = 'hermes.conn.cookie';
const K_THEME = 'hermes.ui.theme';
const K_ACTIVE_PROFILE = 'hermes.ui.activeProfile';
const K_LAST_SESSION = 'hermes.ui.lastSession';
const K_LAST_SESSION_PREFIX = 'hermes.ui.lastSession.profile';
const K_MODEL = 'hermes.ui.model';
const K_MODEL_PREFIX = 'hermes.ui.model.profile';
const K_MODEL_PROVIDER = 'hermes.ui.modelProvider';
const K_MODEL_PROVIDER_PREFIX = 'hermes.ui.modelProvider.profile';
const DEFAULT_PROFILE = 'default';

function normalizeProfile(profile: string | null | undefined): string {
  return String(profile ?? '').trim() || DEFAULT_PROFILE;
}

function profileStorageKey(prefix: string, profile: string): string {
  return `${prefix}.${encodeURIComponent(normalizeProfile(profile))}`;
}

/** Persist the global UI profile independently from the server's launch profile. */
export async function saveActiveProfile(profile: string): Promise<void> {
  await set(K_ACTIVE_PROFILE, normalizeProfile(profile));
}

export async function getActiveProfile(): Promise<string | null> {
  return get(K_ACTIVE_PROFILE);
}

/** Remember the session the user was viewing in each profile. */
export async function saveLastSession(id: string, profile = DEFAULT_PROFILE): Promise<void> {
  if (id) await set(profileStorageKey(K_LAST_SESSION_PREFIX, profile), id);
}

export async function getLastSession(profile = DEFAULT_PROFILE): Promise<string | null> {
  const scoped = await get(profileStorageKey(K_LAST_SESSION_PREFIX, profile));
  if (scoped) return scoped;
  // Migrate the pre-profile value only into the default namespace.
  return normalizeProfile(profile) === DEFAULT_PROFILE ? get(K_LAST_SESSION) : null;
}

const K_NOTIFY = 'hermes.ui.notify';

/** Remember the last picked model per profile across restarts. */
export async function saveModel(
  provider: string,
  model: string,
  profile = DEFAULT_PROFILE,
): Promise<void> {
  await Promise.all([
    set(profileStorageKey(K_MODEL_PROVIDER_PREFIX, profile), provider ?? ''),
    set(profileStorageKey(K_MODEL_PREFIX, profile), model ?? ''),
  ]);
}

export async function getModel(profile = DEFAULT_PROFILE): Promise<{ provider: string; model: string } | null> {
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
export async function saveKanbanBoard(slug: string): Promise<void> {
  await set(K_KANBAN_BOARD, slug ?? '');
}

export async function getKanbanBoard(): Promise<string | null> {
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
    const v = useWebStore ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
    // Cache hits AND misses (null) so repeat boot reads don't hit keychain again.
    // Miss cache is short-lived to avoid stale first-run writes.
    memCache.set(key, v);
    return v;
  } catch {
    return memCache.get(key) ?? null;
  }
}

async function set(key: string, value: string): Promise<void> {
  memCache.set(key, value);
  try {
    if (useWebStore) {
      await AsyncStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    }
  } catch {
    // Storage is best-effort (e.g. private mode) — never fail login over it.
  }
}

async function del(key: string): Promise<void> {
  memCache.delete(key);
  try {
    if (useWebStore) await AsyncStorage.removeItem(key);
    else await SecureStore.deleteItemAsync(key);
  } catch {}
}

export async function loadConnection(): Promise<Connection> {
  const [host, username, password, cookie] = await Promise.all([
    get(K_HOST),
    get(K_USERNAME),
    get(K_PASSWORD),
    get(K_COOKIE),
  ]);
  return {
    host: host ?? '',
    username: username ?? '',
    hasPassword: !!password,
    hasCookie: !!cookie,
  };
}

export async function saveHost(host: string, username: string): Promise<void> {
  await Promise.all([set(K_HOST, host.trim()), set(K_USERNAME, username.trim())]);
}

export async function savePassword(password: string): Promise<void> {
  if (password) await set(K_PASSWORD, password);
}

export async function getPassword(): Promise<string | null> {
  return get(K_PASSWORD);
}

export async function saveCookie(cookie: string): Promise<void> {
  // Web keeps the real cookie in the browser jar (JS can't see it) and the
  // login flow yields an empty string — persist a marker so boot knows a
  // session may exist and attempts the silent reconnect (validated via me).
  if (useWebStore) {
    await set(K_COOKIE, cookie || 'web-jar');
    return;
  }
  if (cookie) await set(K_COOKIE, cookie);
}

export async function getCookie(): Promise<string | null> {
  return get(K_COOKIE);
}

export async function clearCookie(): Promise<void> {
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

export async function forgetAll(): Promise<void> {
  await Promise.all([del(K_PASSWORD), del(K_COOKIE)]);
}
