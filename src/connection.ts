import * as SecureStore from 'expo-secure-store';

// Connection + credential vault. Secrets (password, session cookie) live in
// SecureStore (encrypted at rest). Non-secrets (host, username) live in
// AsyncStorage-equivalent plain storage — here also SecureStore for simplicity,
// keyed separately so a "forget password" can wipe just the secret.

const K_HOST = 'hermes.conn.host';
const K_USERNAME = 'hermes.conn.username';
const K_PASSWORD = 'hermes.conn.password';
const K_COOKIE = 'hermes.conn.cookie';

export interface Connection {
  host: string; // e.g. http://192.168.1.8:9119
  username: string;
  hasPassword: boolean;
  hasCookie: boolean;
}

async function get(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function set(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

async function del(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
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
  if (cookie) await set(K_COOKIE, cookie);
}

export async function getCookie(): Promise<string | null> {
  return get(K_COOKIE);
}

export async function clearCookie(): Promise<void> {
  await del(K_COOKIE);
}

export async function forgetAll(): Promise<void> {
  await Promise.all([del(K_PASSWORD), del(K_COOKIE)]);
}
