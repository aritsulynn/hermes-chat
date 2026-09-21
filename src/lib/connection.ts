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

const K_HOST = 'hermes.conn.host';
const K_USERNAME = 'hermes.conn.username';
const K_PASSWORD = 'hermes.conn.password';
const K_COOKIE = 'hermes.conn.cookie';
const K_THEME = 'hermes.ui.theme';

export interface Connection {
  host: string; // e.g. http://192.168.1.8:9119
  username: string;
  hasPassword: boolean;
  hasCookie: boolean;
}

async function get(key: string): Promise<string | null> {
  try {
    return useWebStore ? await AsyncStorage.getItem(key) : await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function set(key: string, value: string): Promise<void> {
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
    host: host ?? 'http://192.168.1.8:9119',
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

export type Theme = 'light' | 'dark';

export async function getTheme(): Promise<Theme | null> {
  const v = await get(K_THEME);
  return v === 'dark' || v === 'light' ? v : null;
}

export async function saveTheme(t: Theme): Promise<void> {
  await set(K_THEME, t);
}

export async function forgetAll(): Promise<void> {
  await Promise.all([del(K_PASSWORD), del(K_COOKIE)]);
}
