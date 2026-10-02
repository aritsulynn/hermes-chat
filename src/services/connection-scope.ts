/** Canonical dashboard base used as part of an account credential scope. */
export function normalizeConnectionBase(host: string): string {
  const raw = String(host ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.username || url.password) return '';
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

/** Opaque, collision-resistant identity for one dashboard origin + username. */
export function connectionScope(host: string, username: string): string {
  const base = normalizeConnectionBase(host);
  const user = String(username ?? '').trim();
  return base && user ? JSON.stringify([base, user]) : '';
}
