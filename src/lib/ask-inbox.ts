export type AskInboxStatus =
  'pending' | 'answering' | 'sent' | 'answered' | 'cancelled' | 'stale';

export interface AskOwner {
  /** Stable identity for the gateway connection (the current host in the mobile client). */
  connectionId: string;
  /** Empty when the gateway did not provide enough metadata to resolve a profile. */
  profile: string;
  storedSessionId: string;
  runtimeSessionId: string;
  /** True only when profile + stored session are known and safe to open/label. */
  resolved: boolean;
}

export interface AskInboxEntry {
  key: string;
  rpcId: string;
  method: string;
  sessionId?: string;
  params: Record<string, unknown>;
  owner: AskOwner;
  status: AskInboxStatus;
  receivedAt: number;
  replayed: boolean;
  notificationId?: string;
}

export interface AskInboxInput {
  rpcId: string;
  method: string;
  sessionId?: string;
  params?: Record<string, unknown>;
  owner: AskOwner;
  receivedAt?: number;
  replayed?: boolean;
  notificationId?: string;
}

/**
 * Key used for UI/notification identity. The rpc id is globally unique for a
 * connection, but retaining the owner dimensions makes stale data fail closed
 * if the client later supports more than one connection.
 */
export function askKey(owner: AskOwner, rpcId: string): string {
  return JSON.stringify([
    owner.connectionId,
    owner.profile,
    owner.storedSessionId,
    owner.runtimeSessionId,
    rpcId,
  ]);
}

/** A request replayed after reconnect is the same request even if runtime changed. */
function sameRequest(
  entries: AskInboxEntry[],
  input: AskInboxInput,
): AskInboxEntry | undefined {
  return entries.find(
    (entry) =>
      entry.owner.connectionId === input.owner.connectionId &&
      entry.rpcId === input.rpcId,
  );
}

export interface UpsertAskResult {
  entries: AskInboxEntry[];
  entry: AskInboxEntry;
  added: boolean;
  changed: boolean;
}

/**
 * Upsert a live or replayed ask. A settled request is never resurrected by a
 * late replay; the caller can safely use `added` to decide whether to notify.
 */
export function upsertAsk(
  entries: AskInboxEntry[],
  input: AskInboxInput,
): UpsertAskResult {
  const now = input.receivedAt ?? Date.now();
  const existing = sameRequest(entries, input);
  const incoming: AskInboxEntry = {
    key: askKey(input.owner, input.rpcId),
    rpcId: input.rpcId,
    method: input.method,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    params: input.params ?? {},
    owner: input.owner,
    status: 'pending',
    receivedAt: now,
    replayed: input.replayed === true,
    ...(input.notificationId ? { notificationId: input.notificationId } : {}),
  };

  if (existing) {
    if (
      existing.status === 'answered' ||
      existing.status === 'cancelled' ||
      existing.status === 'stale'
    ) {
      return { entries, entry: existing, added: false, changed: false };
    }
    const next: AskInboxEntry = {
      ...existing,
      key: incoming.key,
      status: 'pending',
      method: incoming.method,
      ...(incoming.sessionId ? { sessionId: incoming.sessionId } : {}),
      params: incoming.params,
      owner: incoming.owner,
      receivedAt: existing.receivedAt || now,
      replayed: incoming.replayed,
      ...(incoming.notificationId
        ? { notificationId: incoming.notificationId }
        : {}),
    };
    const changed =
      JSON.stringify({
        ...existing,
        key: undefined,
        receivedAt: undefined,
        replayed: undefined,
      }) !==
      JSON.stringify({
        ...next,
        key: undefined,
        receivedAt: undefined,
        replayed: undefined,
      });
    const nextEntries = entries.map((entry) =>
      entry.key === existing.key ? next : entry,
    );
    return { entries: nextEntries, entry: next, added: false, changed };
  }

  return {
    entries: [incoming, ...entries],
    entry: incoming,
    added: true,
    changed: true,
  };
}

export function setAskStatus(
  entries: AskInboxEntry[],
  key: string,
  status: AskInboxStatus,
): AskInboxEntry[] {
  return entries.map((entry) =>
    entry.key === key ? { ...entry, status } : entry,
  );
}

export function setAskStatusByRpc(
  entries: AskInboxEntry[],
  connectionId: string,
  rpcId: string,
  status: AskInboxStatus,
): AskInboxEntry[] {
  return entries.map((entry) =>
    entry.owner.connectionId === connectionId && entry.rpcId === rpcId
      ? { ...entry, status }
      : entry,
  );
}

export function pendingAsks(entries: AskInboxEntry[]): AskInboxEntry[] {
  return entries.filter(
    (entry) =>
      entry.status === 'pending' ||
      entry.status === 'answering' ||
      entry.status === 'sent',
  );
}

export function findAsk(
  entries: AskInboxEntry[],
  key: string,
): AskInboxEntry | undefined {
  return entries.find((entry) => entry.key === key);
}

export function findAskByRpc(
  entries: AskInboxEntry[],
  connectionId: string,
  rpcId: string,
): AskInboxEntry | undefined {
  return sameRequest(entries, {
    rpcId,
    method: '',
    owner: {
      connectionId,
      profile: '',
      storedSessionId: '',
      runtimeSessionId: '',
      resolved: false,
    },
  });
}
