// Session-ops slice — openSession (resume) and newSession (create).
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { router } from 'expo-router';
import type { GatewayWs, HistoryMessage, ServerAsk } from '../../services/gateway-ws';
import { getSessionMessages } from '../../services/dashboard';
import { connectionScope, saveLastSession } from '../../services/connection';
import { CHAT_HISTORY_PAGE } from '../../services/constants';
import { errMsg, normalizeTodos } from '../../utils/messages';
import type { Attachment, QueuedPrompt, SubagentRow, TodoItem, UiMessage } from '../../utils/messages';
import type { AskInboxEntry, AskOwner } from '../../services/ask-inbox';
import { historyToItems, mergeUsageState, normalizeProfileName, profileSessionKey, serverAskFromInbox } from '../helpers';
import type { ScopedSessionSummary, SessionInfo, UsageInfo } from '../types';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface SessionOpsSliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  acceptRotatedCookie: (
    nextCookie: string,
    host: string,
    username: string,
    connectionEpoch: number,
    profileEpoch: number,
  ) => Promise<void>;
  bindAskOwner: (runtimeSessionId: string, owner: AskOwner) => void;
  hydrateSessionContext: (g: GatewayWs, sid: string) => void;
  parkLiveTurn: () => void;
  clearStreaming: () => void;
  reanchorLiveTurn: (items: UiMessage[]) => UiMessage[];
  setAsk: Dispatch<SetStateAction<ServerAsk | null>>;
  askRef: MutableRefObject<ServerAsk | null>;
  setOpeningId: Dispatch<SetStateAction<string | null>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setToolLine: Dispatch<SetStateAction<string | null>>;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  setSessionKey: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionTitle: Dispatch<SetStateAction<string>>;
  setInputRaw: (value: string) => void;
  draftsRef: MutableRefObject<Map<string, string>>;
  draftKeyRef: MutableRefObject<string>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  setUsageInfo: Dispatch<SetStateAction<UsageInfo | null>>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setSessions: Dispatch<SetStateAction<ScopedSessionSummary[]>>;
  setSubagents: Dispatch<SetStateAction<SubagentRow[]>>;
  setEditingRowId: Dispatch<SetStateAction<number | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setQueued: Dispatch<SetStateAction<QueuedPrompt[]>>;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  askInboxRef: MutableRefObject<AskInboxEntry[]>;
  queuedRef: MutableRefObject<QueuedPrompt[]>;
  queueParkedRef: MutableRefObject<boolean>;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  liveTools: MutableRefObject<Map<string, string>>;
  liveToolAid: MutableRefObject<string | null>;
  liveTurnTools: MutableRefObject<string[]>;
  parkedLiveRef: MutableRefObject<Set<string>>;
  lastTurnEventAt: MutableRefObject<number>;
  model: string;
  modelProvider: string;
  effort: string;
  /** Record the loaded tail window after open (limit + exhausted flag). */
  noteHistoryWindow: (limit: number, exhausted: boolean) => void;
  /** Clear the window on empty/new sessions. */
  resetHistoryWindow: () => void;
}

export interface SessionOpsSlice {
  openSession: (s: ScopedSessionSummary) => Promise<void>;
  newSession: () => Promise<void>;
}

export function useSessionOpsSlice(deps: SessionOpsSliceDeps): SessionOpsSlice {
  const {
    runtime,
    latest,
    acceptRotatedCookie,
    bindAskOwner,
    hydrateSessionContext,
    parkLiveTurn,
    clearStreaming,
    reanchorLiveTurn,
    setAsk,
    askRef,
    setOpeningId,
    setGenerating,
    setToolLine,
    setTodos,
    setSessionKey,
    setSessionId,
    setSessionTitle,
    setInputRaw,
    draftsRef,
    draftKeyRef,
    setAttachments,
    setSessionInfo,
    setUsageInfo,
    setMessages,
    setSessions,
    setSubagents,
    setEditingRowId,
    setBusy,
    setError,
    setQueued,
    setQueueParked,
    askInboxRef,
    queuedRef,
    queueParkedRef,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    parkedLiveRef,
    lastTurnEventAt,
    model,
    modelProvider,
    effort,
    noteHistoryWindow,
    resetHistoryWindow,
  } = deps;
  const {
    gw,
    cookie,
    activeProfileRef,
    profileEpochRef,
    connectionEpochRef,
    sessionOpenEpochRef,
    sessionIdRef,
    messagesRef,
    generatingRef,
    runtimeOwners,
    editingRowRef: editRowRef,
    openSessionRef,
    newSessionRef,
  } = runtime;

  const openSession = useCallback(
    async (s: ScopedSessionSummary) => {
      const g = gw.current;
      if (!g) {
        setError('Not connected — please login again');
        return;
      }
      const connectionEpoch = connectionEpochRef.current;
      const profile = normalizeProfileName(s.profile ?? activeProfileRef.current);
      const targetHost = latest.current.host;
      const targetUser = latest.current.username;
      const epoch = profileEpochRef.current;
      const openEpoch = ++sessionOpenEpochRef.current;
      const isLatestOpen = () => openEpoch === sessionOpenEpochRef.current;
      const isSameConnection = () => connectionEpochRef.current === connectionEpoch && gw.current === g;
      const previousRuntimeId = sessionIdRef.current;
      const previousSessionKey = latest.current.sessionKey;
      const previousMessages = messagesRef.current;
      const previousAsk = askRef.current;
      const previousGenerating = generatingRef.current;
      const previousLiveAid = liveAid.current;
      const previousLiveThinkAid = liveThinkAid.current;
      if (activeProfileRef.current !== profile) return;
      // The ask slot is foreground-only; pending requests remain in the inbox.
      askRef.current = null;
      setAsk(null);
      // Leaving a mid-turn session strands the latch: the old turn's onComplete
      // is filtered by isCurrentSession, so park it (restored on return) and
      // reset the local Stop/Send state. The server turn keeps running.
      parkLiveTurn();
      // Fence the old runtime while resume/history is in flight. Otherwise a late
      // event from the old room can mutate the room being opened.
      sessionIdRef.current = null;
      setSessionId(null);
      setOpeningId(s.id);
      setError(null);
      liveAid.current = null;
      liveThinkAid.current = null;
      liveTools.current.clear();
      liveToolAid.current = null;
      liveTurnTools.current = [];
      setGenerating(false);
      generatingRef.current = false;
      setToolLine(null);
      try {
        // resume mints a FRESH live runtime id — history/submit/interrupt must use
        // the returned session_id, NOT the stored id (server keeps two id spaces).
        const r: any = await g.call('session.resume', {
          profile,
          session_id: s.id,
          omit_messages: false,
        });
        const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : s.id;
        if (
          !isLatestOpen() ||
          !isSameConnection() ||
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch
        )
          return;
        const resumeInfo = r?.info && typeof r.info === 'object' && !Array.isArray(r.info) ? r.info : null;
        // Resume carries the session's todo snapshot; restore the checklist.
        setTodos(normalizeTodos(r?.todo_state));
        // Full transcript via REST first (tool RESULT content + reasoning) —
        // WS session.history is only a compact projection. Stored id, not live.
        // Windowed: the latest page only — older rows page in on demand so a
        // 10k-message transcript never lands in JS memory all at once.
        let hist: HistoryMessage[];
        let historyExhausted = true;
        try {
          // Gate on the cookie ONLY as a fallback signal: on web the jar is empty
          // (JS can't read Set-Cookie) while the browser cookie still authenticates
          // via `credentials: 'include'`, so always try REST.
          hist = await getSessionMessages(
            targetHost,
            cookie.current,
            s.id,
            profile,
            CHAT_HISTORY_PAGE,
            connectionScope(targetHost, targetUser),
            async (nextCookie) => acceptRotatedCookie(nextCookie, targetHost, targetUser, connectionEpoch, epoch),
          );
          historyExhausted = hist.length < CHAT_HISTORY_PAGE;
        } catch {
          hist = [];
        }
        if (hist.length === 0) hist = await g.history(liveId);
        if (
          !isLatestOpen() ||
          !isSameConnection() ||
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch
        )
          return;
        const owner = profileSessionKey(profile, s.id);
        runtimeOwners.current.set(liveId, owner);
        bindAskOwner(liveId, {
          connectionId: connectionScope(latest.current.host, latest.current.username),
          profile,
          storedSessionId: s.id,
          runtimeSessionId: liveId,
          resolved: true,
        });
        setSessionKey(s.id);
        void saveLastSession(s.id, profile, connectionScope(targetHost, targetUser));
        sessionIdRef.current = liveId;
        setSessionId(liveId);
        draftKeyRef.current = owner;
        setInputRaw(draftsRef.current.get(owner) ?? '');
        setAttachments([]);
        const pendingRoomAsk = askInboxRef.current.find(
          (entry) =>
            entry.owner.profile === profile &&
            entry.owner.storedSessionId === s.id &&
            (entry.status === 'pending' || entry.status === 'answering'),
        );
        if (pendingRoomAsk) setAsk(serverAskFromInbox(pendingRoomAsk));
        // A live resume already returns the authoritative runtime info. Applying
        // it here avoids depending on a later session.info broadcast, which can
        // race the REST transcript load while the previous runtime is still current.
        setSessionInfo(resumeInfo);
        setUsageInfo(resumeInfo?.usage ?? null);
        setSessionTitle(s.title || '');
        void g
          .usage(liveId)
          .then((info) => {
            if (isLatestOpen() && isSameConnection() && sessionIdRef.current === liveId) {
              setUsageInfo((prev) => mergeUsageState(prev, info));
            }
          })
          .catch(() => {});
        hydrateSessionContext(g, liveId);
        // Reasoning rides on the assistant message (sidecar, not its own role) —
        // restore it as a thinking bubble above its answer, like the live view.
        const items = historyToItems(hist);
        clearStreaming();
        const resumedRunning =
          r?.running === true || r?.status === 'working' || (r?.inflight != null && typeof r.inflight === 'object');
        if (parkedLiveRef.current.has(owner) || resumedRunning) {
          // Back in a room whose turn is still live — re-anchor streaming to the
          // transcript tail and re-arm Stop.
          setMessages(reanchorLiveTurn(items));
          lastTurnEventAt.current = Date.now();
          setGenerating(true);
          generatingRef.current = true;
        } else {
          setMessages(items);
        }
        noteHistoryWindow(CHAT_HISTORY_PAGE, historyExhausted);
        queuedRef.current = [];
        setQueued([]);
        queueParkedRef.current = false;
        setQueueParked(false);
        editRowRef.current = null;
        setEditingRowId(null);
        setSubagents([]);
        router.push('/chat');
      } catch (e) {
        if (
          !isLatestOpen() ||
          !isSameConnection() ||
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch
        )
          return;
        sessionIdRef.current = previousRuntimeId;
        setSessionId(previousRuntimeId);
        if (previousSessionKey) setSessionKey(previousSessionKey);
        messagesRef.current = previousMessages;
        setMessages(previousMessages);
        askRef.current = previousAsk;
        setAsk(previousAsk);
        generatingRef.current = previousGenerating;
        setGenerating(previousGenerating);
        liveAid.current = previousLiveAid;
        liveThinkAid.current = previousLiveThinkAid;
        const msg = errMsg(e);
        if (/not.?found/i.test(msg)) {
          // Stale entry — the session is gone server-side (pruned/deleted).
          // Drop it so the list stops lying.
          setSessions((prev) => prev.filter((x) => x.id !== s.id));
          setError(`"${s.title || '(untitled)'}" no longer exists (deleted/pruned) — removed it from the list`);
        } else {
          setError(msg);
        }
      } finally {
        if (isLatestOpen() && isSameConnection() && activeProfileRef.current === profile) setOpeningId(null);
      }
    },
    [acceptRotatedCookie, hydrateSessionContext, bindAskOwner, noteHistoryWindow],
  );
  openSessionRef.current = openSession;

  const newSession = useCallback(async () => {
    const g = gw.current;
    if (!g) return;
    const connectionEpoch = connectionEpochRef.current;
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    const openEpoch = ++sessionOpenEpochRef.current;
    const isLatestOpen = () => openEpoch === sessionOpenEpochRef.current;
    const isSameConnection = () => connectionEpochRef.current === connectionEpoch && gw.current === g;
    const previousRuntimeId = sessionIdRef.current;
    const previousSessionKey = latest.current.sessionKey;
    const previousMessages = messagesRef.current;
    const previousAsk = askRef.current;
    const previousGenerating = generatingRef.current;
    askRef.current = null;
    setAsk(null);
    setBusy(true);
    setError(null);
    // Same stranded-latch guard as openSession (see above).
    parkLiveTurn();
    sessionIdRef.current = null;
    setSessionId(null);
    liveAid.current = null;
    liveThinkAid.current = null;
    setGenerating(false);
    generatingRef.current = false;
    setToolLine(null);
    try {
      const result: any = await g.call('session.create', {
        profile,
        ...(model ? { model } : {}),
        ...(modelProvider ? { provider: modelProvider } : {}),
        ...(effort ? { reasoning_effort: effort.toLowerCase() } : {}),
      });
      const sid = String(result?.session_id ?? '');
      const storedSessionId = String(result?.stored_session_id ?? sid);
      if (!sid) throw new Error('Profile session creation returned no session id');
      if (
        !isLatestOpen() ||
        !isSameConnection() ||
        activeProfileRef.current !== profile ||
        profileEpochRef.current !== epoch
      )
        return;
      const owner = profileSessionKey(profile, storedSessionId || sid);
      runtimeOwners.current.set(sid, owner);
      bindAskOwner(sid, {
        connectionId: connectionScope(latest.current.host, latest.current.username),
        profile,
        storedSessionId: storedSessionId || sid,
        runtimeSessionId: sid,
        resolved: true,
      });
      setSessionKey(storedSessionId || sid);
      void saveLastSession(
        storedSessionId || sid,
        profile,
        connectionScope(latest.current.host, latest.current.username),
      );
      sessionIdRef.current = sid;
      setSessionId(sid);
      setSessionTitle('');
      setMessages([]);
      resetHistoryWindow();
      clearStreaming();
      queuedRef.current = [];
      setQueued([]);
      queueParkedRef.current = false;
      setQueueParked(false);
      editRowRef.current = null;
      setEditingRowId(null);
      setTodos([]);
      setSubagents([]);
      draftKeyRef.current = owner;
      setInputRaw(draftsRef.current.get(owner) ?? '');
      setAttachments([]);
      setSessionInfo(null);
      setUsageInfo(null);
      liveTools.current.clear();
      liveToolAid.current = null;
      router.push('/chat');
    } catch (e) {
      if (
        isLatestOpen() &&
        isSameConnection() &&
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch
      ) {
        sessionIdRef.current = previousRuntimeId;
        setSessionId(previousRuntimeId);
        if (previousSessionKey) setSessionKey(previousSessionKey);
        messagesRef.current = previousMessages;
        setMessages(previousMessages);
        askRef.current = previousAsk;
        setAsk(previousAsk);
        generatingRef.current = previousGenerating;
        setGenerating(previousGenerating);
        setError(errMsg(e));
      }
    } finally {
      if (
        isLatestOpen() &&
        isSameConnection() &&
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch
      ) {
        setBusy(false);
      }
    }
  }, [model, modelProvider, effort, bindAskOwner, resetHistoryWindow]);
  newSessionRef.current = newSession;

  return { openSession, newSession };
}
