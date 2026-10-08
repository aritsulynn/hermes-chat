// Transcript tail cache — P3 local-first, slice 1.
//
// The idea is small on purpose: the transcript already lives in memory and is
// refetched from REST on every open, so a reload or a slow network means a
// blank screen until `session.resume` + history land. Keeping the last page of
// the *display* transcript in best-effort local storage lets openSession paint
// instantly and let the network replace it behind — the same "stale while
// revalidate" shape as the connection vault (see services/connection.ts).
//
// Deliberately NOT SQLite yet: the full P3 wants durable history + outbox in a
// real store, but that is a dependency + migration. This file proves the read
// path (paint fast, then reconcile) with the storage contract we already have:
// best-effort, never fail the app, scoped per dashboard account so one
// account's tail never leaks into another's.
import { nid } from '../utils/messages.ts';
import type { Role, UiMessage } from '../utils/messages.ts';

/** Newest bubbles kept per session — one REST page worth. */
export const TRANSCRIPT_TAIL_MAX = 50;
/** Per-text ceiling so one giant tool output cannot blow the 5MB quota. */
export const TRANSCRIPT_TEXT_MAX = 4000;

const KEY_PREFIX = 'hermes.chat.tail.v1.';

function hexEncode(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) out += value.charCodeAt(i).toString(16).padStart(4, '0');
  return out;
}

export function transcriptTailKey(scope: string, profile: string, sessionId: string): string {
  return `${KEY_PREFIX}${hexEncode(scope)}.${hexEncode(profile.trim() || 'default')}.${hexEncode(sessionId)}`;
}

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

interface CachedMessage {
  role: Role;
  text: string;
  ts?: number;
  rowId?: number;
  output?: string;
  command?: string;
  diff?: string;
}

const CACHEABLE_ROLES: ReadonlySet<Role> = new Set(['user', 'assistant', 'tool', 'thinking', 'summary']);

function clip(text: string): string {
  return text.length > TRANSCRIPT_TEXT_MAX ? text.slice(0, TRANSCRIPT_TEXT_MAX) : text;
}

/** Strip a live transcript down to what is worth repainting on next boot. */
export function toCachedTail(messages: UiMessage[]): CachedMessage[] {
  const out: CachedMessage[] = [];
  for (const m of messages) {
    if (m.pending) continue;
    if (!CACHEABLE_ROLES.has(m.role)) continue;
    if (!m.text.trim() && !(m.role === 'tool' && m.output?.trim())) continue;
    // Blob/data URIs die with the page — a cached thumbnail would render broken.
    out.push({
      role: m.role,
      text: clip(m.text),
      ...(m.ts != null ? { ts: m.ts } : {}),
      ...(m.rowId != null ? { rowId: m.rowId } : {}),
      ...(m.output ? { output: clip(m.output) } : {}),
      ...(m.command ? { command: clip(m.command) } : {}),
      ...(m.diff ? { diff: clip(m.diff) } : {}),
    });
  }
  return out.slice(-TRANSCRIPT_TAIL_MAX);
}

export async function saveTranscriptTail(
  scope: string,
  profile: string,
  sessionId: string,
  messages: UiMessage[],
): Promise<void> {
  if (!sessionId) return;
  const store = ls();
  if (!store) return;
  const tail = toCachedTail(messages);
  if (tail.length === 0) return;
  const key = transcriptTailKey(scope, profile, sessionId);
  const payload = JSON.stringify({
    v: 1,
    savedAt: Date.now(),
    messages: tail,
  });
  try {
    store.setItem(key, payload);
  } catch {
    // Quota pressure — evict the oldest tail once and retry. Anything still
    // failing is dropped: the network remains the source of truth.
    try {
      evictOldestTail(store, key);
      store.setItem(key, payload);
    } catch {
      // Best-effort: a failed cache write must never fail the chat.
    }
  }
}

function evictOldestTail(store: Storage, keepOut: string): void {
  let oldestKey: string | null = null;
  let oldestAt = Number.POSITIVE_INFINITY;
  for (let i = 0; i < store.length; i++) {
    const k = store.key(i);
    if (!k || !k.startsWith(KEY_PREFIX) || k === keepOut) continue;
    try {
      const raw = store.getItem(k);
      const parsed = raw ? (JSON.parse(raw) as { savedAt?: unknown }) : null;
      const at = typeof parsed?.savedAt === 'number' ? parsed.savedAt : Number.POSITIVE_INFINITY;
      if (at < oldestAt) {
        oldestAt = at;
        oldestKey = k;
      }
    } catch {
      oldestKey = k;
      break;
    }
  }
  if (oldestKey) store.removeItem(oldestKey);
}

function isCachedMessage(row: unknown): row is CachedMessage {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const r = row as Record<string, unknown>;
  return typeof r.role === 'string' && CACHEABLE_ROLES.has(r.role as Role) && typeof r.text === 'string';
}

export async function loadTranscriptTail(scope: string, profile: string, sessionId: string): Promise<UiMessage[]> {
  const store = ls();
  if (!store || !sessionId) return [];
  let raw: string | null;
  try {
    raw = store.getItem(transcriptTailKey(scope, profile, sessionId));
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; messages?: unknown };
    if (!Array.isArray(parsed.messages)) return [];
    const out: UiMessage[] = [];
    for (const row of parsed.messages) {
      if (!isCachedMessage(row)) continue;
      out.push({
        id: nid(),
        role: row.role,
        text: row.text,
        ...(row.ts != null ? { ts: row.ts } : {}),
        ...(row.rowId != null ? { rowId: row.rowId } : {}),
        ...(row.output ? { output: row.output } : {}),
        ...(row.command ? { command: row.command } : {}),
        ...(row.diff ? { diff: row.diff } : {}),
      });
    }
    return out.slice(-TRANSCRIPT_TAIL_MAX);
  } catch {
    return [];
  }
}
