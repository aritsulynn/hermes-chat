// Session-misc slice — renameSession / deleteSessionById / redirectLive /
// setGlobalModel.
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { router } from 'expo-router';
import { setMainModel } from '../../services/dashboard';
import { connectionScope, saveModel } from '../../services/connection';
import type { ServerAsk } from '../../services/gateway-ws';
import type { AskInboxEntry, AskOwner } from '../../services/ask-inbox';
import { errMsg, nid } from '../../utils/messages';
import type { SubagentRow, TodoItem, UiMessage } from '../../utils/messages';
import { profileSessionKey } from '../helpers';
import type { ScopedSessionSummary } from '../types';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface SessionMiscSliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  activeProfile: string;
  sessionId: string | null;
  sessionKey: string | null;
  host: string;
  username: string;
  acceptRotatedCookie: (
    nextCookie: string,
    host: string,
    username: string,
    connectionEpoch: number,
    profileEpoch: number,
  ) => Promise<void>;
  bindAskOwner: (runtimeSessionId: string, owner: AskOwner) => void;
  clearStreaming: () => void;
  askInboxRef: MutableRefObject<AskInboxEntry[]>;
  setAskInbox: Dispatch<SetStateAction<AskInboxEntry[]>>;
  turnOwnerRef: MutableRefObject<Map<string, string>>;
  parkedLiveRef: MutableRefObject<Set<string>>;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  draftsRef: MutableRefObject<Map<string, string>>;
  setInputRaw: (value: string) => void;
  queuedRef: MutableRefObject<any[]>;
  setQueued: Dispatch<SetStateAction<any[]>>;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  setModel: Dispatch<SetStateAction<string>>;
  setModelProvider: Dispatch<SetStateAction<string>>;
  setSessionKey: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionTitle: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setSessions: Dispatch<SetStateAction<ScopedSessionSummary[]>>;
  setSessionInfo: Dispatch<SetStateAction<any>>;
  setUsageInfo: Dispatch<SetStateAction<any>>;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  setSubagents: Dispatch<SetStateAction<SubagentRow[]>>;
  setAsk: Dispatch<SetStateAction<ServerAsk | null>>;
  setToolLine: Dispatch<SetStateAction<string | null>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setEditingRowId: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export interface SessionMiscSlice {
  renameSession: (title: string) => Promise<void>;
  deleteSessionById: (storedId: string) => Promise<void>;
  redirectLive: (text: string) => Promise<void>;
  setGlobalModel: (providerSlug: string, modelId: string) => Promise<void>;
}

export function useSessionMiscSlice(deps: SessionMiscSliceDeps): SessionMiscSlice {
  const {
    runtime,
    latest,
    activeProfile,
    sessionId,
    sessionKey,
    host,
    username,
    acceptRotatedCookie,
    bindAskOwner,
    clearStreaming,
    askInboxRef,
    setAskInbox,
    turnOwnerRef,
    parkedLiveRef,
    liveAid,
    liveThinkAid,
    draftsRef,
    setInputRaw,
    queuedRef,
    setQueued,
    setQueueParked,
    setModel,
    setModelProvider,
    setSessionKey,
    setSessionId,
    setSessionTitle,
    setMessages,
    setSessions,
    setSessionInfo,
    setUsageInfo,
    setTodos,
    setSubagents,
    setAsk,
    setToolLine,
    setGenerating,
    setEditingRowId,
    setError,
  } = deps;
  const {
    gw,
    cookie,
    activeProfileRef,
    profileEpochRef,
    connectionEpochRef,
    sessionIdRef,
    runtimeOwners,
    runtimeAskOwners,
    generatingRef,
    editingRowRef: editRowRef,
    renameSessionRef,
  } = runtime;

  const renameSession = useCallback(
    async (title: string) => {
      const g = gw.current;
      const sid = sessionId ?? sessionKey;
      const stored = sessionKey;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const t = title.trim();
      if (!g || !sid || !t) return;
      await g.rename(sid, t);
      if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      setSessionTitle(t);
      if (stored) {
        setSessions((prev) => prev.map((s) => (s.id === stored ? { ...s, title: t } : s)));
      }
    },
    [activeProfile, sessionId, sessionKey],
  );
  renameSessionRef.current = renameSession;

  const deleteSessionById = useCallback(
    async (storedId: string) => {
      const g = gw.current;
      const profile = activeProfileRef.current;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      if (!g) return;
      try {
        await g.deleteSession(storedId, profile);
      } catch {
        // Fall back to close when the backend has no delete route.
        try {
          await g.closeSession(storedId);
        } catch (e) {
          if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
            setError(errMsg(e));
          }
          return;
        }
      }
      if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      const ownerKey = profileSessionKey(profile, storedId);
      const nextAskInbox = askInboxRef.current.map((entry) =>
        entry.owner.profile === profile && entry.owner.storedSessionId === storedId
          ? { ...entry, status: 'stale' as const }
          : entry,
      );
      askInboxRef.current = nextAskInbox;
      setAskInbox(nextAskInbox);
      setSessions((prev) => prev.filter((s) => s.id !== storedId));
      draftsRef.current.delete(ownerKey);
      parkedLiveRef.current.delete(ownerKey);
      for (const [liveSid, owner] of turnOwnerRef.current) {
        if (owner === ownerKey) turnOwnerRef.current.delete(liveSid);
      }
      for (const [runtime, owner] of runtimeOwners.current) {
        if (owner === ownerKey) runtimeOwners.current.delete(runtime);
      }
      for (const [runtime, owner] of runtimeAskOwners.current) {
        if (owner.storedSessionId === storedId) runtimeAskOwners.current.delete(runtime);
      }
      if (sessionKey === storedId) {
        setSessionKey(null);
        sessionIdRef.current = null;
        setSessionId(null);
        setSessionTitle('');
        setMessages([]);
        clearStreaming();
        liveAid.current = null;
        liveThinkAid.current = null;
        setInputRaw('');
        setSessionInfo(null);
        setUsageInfo(null);
        setTodos([]);
        setSubagents([]);
        queuedRef.current = [];
        setQueued([]);
        setQueueParked(false);
        setGenerating(false);
        generatingRef.current = false;
        editRowRef.current = null;
        setEditingRowId(null);
        setAsk(null);
        setToolLine(null);
        router.replace('/chat');
      }
    },
    [sessionKey],
  );

  const redirectLive = useCallback(
    async (text: string) => {
      const g = gw.current;
      const t = text.trim();
      const profile = activeProfileRef.current;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      const sid = sessionId;
      if (!g || !sid || !t) return;
      const sameRoom = () =>
        connectionEpochRef.current === connectionEpoch &&
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch &&
        (sessionIdRef.current === sid ||
          runtimeOwners.current.get(sessionIdRef.current ?? '') === profileSessionKey(profile, sessionKey ?? sid));
      setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `↪ steer: ${t.slice(0, 120)}` }]);
      try {
        const r: any = await g.redirect(sid, t);
        if (!sameRoom()) return;
        // The turn was already past its steerable point, so the server keeps
        // the text as the next user turn instead of dropping it.
        if (r?.status === 'queued') {
          setMessages((prev) => [
            ...prev,
            {
              id: nid(),
              role: 'notice',
              text: '↪ too late to steer this turn — queued as the next message',
            },
          ]);
        }
      } catch (e: any) {
        if (!sameRoom()) return;
        const msg = e?.message ?? String(e);
        // Live runtime expired server-side — same recovery as send().
        if ((e?.code === 4001 || /not.?found/i.test(msg)) && sessionKey) {
          try {
            const r: any = await g.call('session.resume', {
              profile,
              session_id: sessionKey,
              omit_messages: false,
            });
            if (!sameRoom()) return;
            const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : sessionKey;
            runtimeOwners.current.set(liveId, profileSessionKey(profile, sessionKey));
            bindAskOwner(liveId, {
              connectionId: connectionScope(latest.current.host, latest.current.username),
              profile,
              storedSessionId: sessionKey,
              runtimeSessionId: liveId,
              resolved: true,
            });
            sessionIdRef.current = liveId;
            setSessionId(liveId);
            await g.redirect(liveId, t);
            return;
          } catch (e2) {
            if (!sameRoom()) return;
            setMessages((prev) => [
              ...prev,
              {
                id: nid(),
                role: 'notice',
                text: `Steer failed: ${errMsg(e2)}`,
              },
            ]);
            return;
          }
        }
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Steer failed: ${errMsg(e)}` }]);
      }
    },
    [sessionId, sessionKey],
  );

  const setGlobalModel = useCallback(
    async (providerSlug: string, modelId: string) => {
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      setModelProvider(providerSlug);
      setModel(modelId);
      void saveModel(providerSlug, modelId, profile, connectionScope(host, username));
      if (!host) return;
      setToolLine('setting global default…');
      try {
        await setMainModel(host, cookie.current, providerSlug, modelId, profile, async (nextCookie) => {
          if (activeProfileRef.current !== profile) return;
          await acceptRotatedCookie(nextCookie, host, username, connectionEpoch, epoch);
        });
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: `Global default → ${providerSlug ? `${providerSlug}:` : ''}${modelId}`,
          },
        ]);
      } catch (e) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: `Global set failed: ${errMsg(e)}`,
          },
        ]);
      } finally {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setToolLine(null);
        }
      }
    },
    [acceptRotatedCookie, activeProfile, host, username],
  );

  return { renameSession, deleteSessionById, redirectLive, setGlobalModel };
}
