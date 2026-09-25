// Ask-inbox bookkeeping slice — the foreground ask + the inbox list, owner
// resolution, and status marking. State/refs/setters are returned because the
// WS handlers, ask replies and logout also read/write them.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { askKey, setAskStatus, setAskStatusByRpc, upsertAsk } from '../../lib/ask-inbox';
import type { AskInboxEntry, AskInboxInput, AskInboxStatus, AskOwner } from '../../lib/ask-inbox';
import { connectionScope } from '../../lib/connection';
import type { ServerAsk } from '../../lib/gateway-ws';
import { dismissNotification } from '../../lib/notifications';
import { normalizeProfileName, parseProfileSessionKey } from '../helpers';
import type { AgentProfile } from '../types';
import type { StoreRuntime } from '../runtime';

export interface AskInboxSliceDeps {
  runtime: StoreRuntime;
  profilesRef: MutableRefObject<AgentProfile[]>;
  latest: MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;
  sessionIdRef: MutableRefObject<string | null>;
}

export interface AskInboxSlice {
  ask: ServerAsk | null;
  setAsk: Dispatch<SetStateAction<ServerAsk | null>>;
  askRef: MutableRefObject<ServerAsk | null>;
  askInbox: AskInboxEntry[];
  setAskInbox: Dispatch<SetStateAction<AskInboxEntry[]>>;
  askInboxRef: MutableRefObject<AskInboxEntry[]>;
  resolveAskOwner: (sessionIdValue?: string, params?: Record<string, unknown>) => AskOwner;
  applyAskInbox: (input: AskInboxInput) => ReturnType<typeof upsertAsk>;
  dismissAskNotifications: (entries?: AskInboxEntry[]) => void;
  markAskStatus: (key: string, status: AskInboxStatus) => void;
  markAskByRpc: (rpcId: string, status: AskInboxStatus) => void;
  bindAskOwner: (runtimeSessionId: string, owner: AskOwner) => void;
}

export function useAskInboxSlice({
  runtime,
  profilesRef,
  latest,
  sessionIdRef,
}: AskInboxSliceDeps): AskInboxSlice {
  const { runtimeOwners, runtimeAskOwners } = runtime;
  const [ask, setAsk] = useState<ServerAsk | null>(null);
  const askRef = useRef<ServerAsk | null>(null);
  askRef.current = ask;
  const [askInbox, setAskInbox] = useState<AskInboxEntry[]>([]);
  const askInboxRef = useRef<AskInboxEntry[]>([]);
  askInboxRef.current = askInbox;

  const resolveAskOwner = useCallback((sessionIdValue?: string, params?: Record<string, unknown>): AskOwner => {
    const runtimeSessionId = String(sessionIdValue ?? '');
    const connectionId = connectionScope(latest.current.host, latest.current.username);
    const hintedProfile =
      typeof params?.profile === 'string'
        ? normalizeProfileName(params.profile)
        : typeof params?.profile_name === 'string'
          ? normalizeProfileName(params.profile_name)
          : '';
    const scoped = runtimeSessionId ? runtimeOwners.current.get(runtimeSessionId) : undefined;
    if (scoped) {
      const parsed = parseProfileSessionKey(scoped);
      if (parsed) {
        return {
          connectionId,
          profile: parsed.profile,
          storedSessionId: parsed.storedSessionId,
          runtimeSessionId,
          resolved: true,
        };
      }
    }
    const known = runtimeSessionId ? runtimeAskOwners.current.get(runtimeSessionId) : undefined;
    if (known) {
      if (known.resolved) return { ...known, connectionId: connectionId || known.connectionId };
      const profile =
        hintedProfile || (profilesRef.current.length === 1 ? normalizeProfileName(latest.current.activeProfile) : '');
      return {
        ...known,
        connectionId: connectionId || known.connectionId,
        profile,
        resolved: Boolean(profile && known.storedSessionId),
      };
    }
    // A request from the live foreground session can be resolved even before
    // the runtime-owner map has been populated (for example during resume).
    if (runtimeSessionId && sessionIdRef.current === runtimeSessionId) {
      return {
        connectionId,
        profile: normalizeProfileName(latest.current.activeProfile),
        storedSessionId: latest.current.sessionKey ?? runtimeSessionId,
        runtimeSessionId,
        resolved: true,
      };
    }
    if (hintedProfile) {
      return {
        connectionId,
        profile: hintedProfile,
        storedSessionId: '',
        runtimeSessionId,
        resolved: false,
      };
    }
    // Background sessions may arrive before the app has ever opened them. Keep
    // them in the inbox, but fail closed for profile-sensitive navigation.
    return {
      connectionId,
      profile: '',
      storedSessionId: '',
      runtimeSessionId,
      resolved: false,
    };
  }, []);

  const applyAskInbox = useCallback((input: AskInboxInput) => {
    const result = upsertAsk(askInboxRef.current, input);
    askInboxRef.current = result.entries;
    setAskInbox(result.entries);
    return result;
  }, []);

  const dismissAskNotifications = useCallback((entries: AskInboxEntry[] = askInboxRef.current) => {
    for (const entry of entries) void dismissNotification(`hermes-ask-${entry.rpcId}`);
  }, []);

  const markAskStatus = useCallback((key: string, status: AskInboxStatus) => {
    const next = setAskStatus(askInboxRef.current, key, status);
    askInboxRef.current = next;
    setAskInbox(next);
    if (status === 'sent' || status === 'answered' || status === 'cancelled' || status === 'stale') {
      const entry = next.find((item) => item.key === key);
      if (entry) void dismissNotification(`hermes-ask-${entry.rpcId}`);
      if (askRef.current && askRef.current.rpcId === entry?.rpcId) {
        setAsk(null);
      }
    }
  }, []);

  const markAskByRpc = useCallback((rpcId: string, status: AskInboxStatus) => {
    const next = setAskStatusByRpc(askInboxRef.current, connectionScope(latest.current.host, latest.current.username), rpcId, status);
    askInboxRef.current = next;
    setAskInbox(next);
    if (status === 'cancelled' || status === 'answered' || status === 'stale') {
      const entry = next.find(
        (item) => item.owner.connectionId === connectionScope(latest.current.host, latest.current.username) && item.rpcId === rpcId,
      );
      if (entry) void dismissNotification(`hermes-ask-${entry.rpcId}`);
    }
    if (status !== 'pending' && status !== 'answering' && askRef.current?.rpcId === rpcId) {
      setAsk(null);
    }
  }, []);

  const bindAskOwner = useCallback((runtimeSessionId: string, owner: AskOwner) => {
    runtimeAskOwners.current.set(runtimeSessionId, owner);
    const next = askInboxRef.current.map((entry) =>
      entry.owner.runtimeSessionId === runtimeSessionId && !entry.owner.resolved
        ? { ...entry, owner, key: askKey(owner, entry.rpcId) }
        : entry,
    );
    askInboxRef.current = next;
    setAskInbox(next);
  }, []);

  return {
    ask,
    setAsk,
    askRef,
    askInbox,
    setAskInbox,
    askInboxRef,
    resolveAskOwner,
    applyAskInbox,
    dismissAskNotifications,
    markAskStatus,
    markAskByRpc,
    bindAskOwner,
  };
}
