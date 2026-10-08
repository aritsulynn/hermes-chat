// Unsent-work outbox — P3 local-first, slice 2.
//
// Slice 1 (transcript-cache.ts) made the *read* path survive a reload: the
// last-known tail paints instantly. This file covers the *write* path: a draft
// being typed and prompts queued mid-turn live only in memory today, so a
// reload — or sending while the socket is down — silently drops them.
//
// The shape is deliberately boring: one best-effort localStorage doc per
// dashboard account holding per-room drafts and queues. No new dependency, no
// migration, same "never fail the app" contract as the connection vault. The
// in-memory queue stays authoritative during the session; this module is only
// the snapshot it is written through to and restored from.
//
// NOTE: this module deliberately uses explicit `.ts` import extensions (see
// services/api.ts header) — it is loaded directly by node's test runner,
// which does no extensionless resolution.
import type { QueuedPrompt } from '../utils/messages.ts';

/** Prompts held per room — more than this is a backlog, not a queue. */
export const OUTBOX_QUEUE_MAX = 20;
/** Draft entries kept — mirrors the composer's in-memory bound. */
export const OUTBOX_DRAFTS_MAX = 50;
/** Per-text ceiling, same as the tail cache: one paste must not blow quota. */
export const OUTBOX_TEXT_MAX = 4000;

const KEY_PREFIX = 'hermes.chat.outbox.v1.';

function hexEncode(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) out += value.charCodeAt(i).toString(16).padStart(4, '0');
  return out;
}

export function outboxKey(scope: string): string {
  return `${KEY_PREFIX}${hexEncode(scope)}`;
}

function ls(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export interface OutboxItem {
  id: string;
  text: string;
  ts: number;
}

export interface OutboxDoc {
  drafts: Array<[string, string]>;
  queues: Record<string, OutboxItem[]>;
}

const EMPTY: OutboxDoc = { drafts: [], queues: {} };

function clip(text: string): string {
  return text.length > OUTBOX_TEXT_MAX ? text.slice(0, OUTBOX_TEXT_MAX) : text;
}

function isItem(row: unknown): row is OutboxItem {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const r = row as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.text === 'string' && typeof r.ts === 'number';
}

/** Read the whole doc; corrupt or missing storage reads as empty. */
export async function loadOutbox(scope: string): Promise<OutboxDoc> {
  const store = ls();
  if (!store || !scope) return structuredClone(EMPTY);
  let raw: string | null;
  try {
    raw = store.getItem(outboxKey(scope));
  } catch {
    return structuredClone(EMPTY);
  }
  if (!raw) return structuredClone(EMPTY);
  try {
    const parsed = JSON.parse(raw) as Partial<OutboxDoc>;
    const drafts = Array.isArray(parsed.drafts)
      ? parsed.drafts.filter(
          (d): d is [string, string] => Array.isArray(d) && typeof d[0] === 'string' && typeof d[1] === 'string',
        )
      : [];
    const queues: Record<string, OutboxItem[]> = {};
    if (parsed.queues && typeof parsed.queues === 'object') {
      for (const [owner, rows] of Object.entries(parsed.queues)) {
        if (Array.isArray(rows)) queues[owner] = rows.filter(isItem);
      }
    }
    return { drafts, queues };
  } catch {
    return structuredClone(EMPTY);
  }
}

async function writeOutbox(scope: string, doc: OutboxDoc): Promise<void> {
  const store = ls();
  if (!store || !scope) return;
  try {
    store.setItem(outboxKey(scope), JSON.stringify(doc));
  } catch {
    // Quota pressure — drop every queue but keep drafts (typed text is the
    // hardest to reproduce), then retry once. Still failing means the network
    // stays the source of truth, same as the tail cache.
    try {
      store.setItem(outboxKey(scope), JSON.stringify({ drafts: doc.drafts, queues: {} }));
    } catch {
      // Best-effort: persistence must never fail the chat.
    }
  }
}

/**
 * Snapshot one room's drafts + queue into the doc. Read-modify-write: callers
 * pass the full drafts map and this room's queue; other rooms are preserved.
 */
export async function saveOwnerState(
  scope: string,
  owner: string | null,
  drafts: Map<string, string> | Array<[string, string]>,
  queue: QueuedPrompt[],
): Promise<void> {
  if (!scope) return;
  const doc = await loadOutbox(scope);
  const entries = (Array.isArray(drafts) ? drafts : [...drafts])
    .filter(([, text]) => text.trim() !== '')
    .slice(-OUTBOX_DRAFTS_MAX)
    .map(([key, text]): [string, string] => [key, clip(text)]);
  doc.drafts = entries;
  if (owner) {
    if (queue.length === 0) delete doc.queues[owner];
    else {
      doc.queues[owner] = queue
        .filter((q) => q.text.trim() !== '')
        .slice(-OUTBOX_QUEUE_MAX)
        .map((q) => ({ id: q.id, text: clip(q.text), ts: Date.now() }));
    }
  }
  await writeOutbox(scope, doc);
}

/** The queued prompts stashed for one room, oldest first. */
export async function loadOwnerQueue(scope: string, owner: string): Promise<OutboxItem[]> {
  const doc = await loadOutbox(scope);
  return doc.queues[owner] ?? [];
}

/** Forget one account's whole doc — logout parity with the in-memory clear. */
export async function clearOutbox(scope: string): Promise<void> {
  const store = ls();
  if (!store || !scope) return;
  try {
    store.removeItem(outboxKey(scope));
  } catch {
    // Best-effort.
  }
}
