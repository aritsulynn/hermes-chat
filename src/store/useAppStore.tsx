// App store orchestrator.
//
// Composes the leaf slices (store/slices/*) and owns the cross-cutting
// orchestration that ties them together: connection/auth, session management,
// the turn engine, and the gateway WS wiring (openWs). The leaf slices hold the
// per-domain state/refs; this file wires them and exposes the `AppStore` context
// consumed via `useApp()` (re-exported from hooks/app-store.tsx).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import {
  checkMe,
  getSessionMessages,
  opsGet as dashboardOpsGet,
  opsMut as dashboardOpsMut,
  passwordLogin,
  setMainModel,
} from '../lib/dashboard';
import {
  clearCookie,
  clearPassword,
  connectionScope,
  getActiveProfile,
  getCookie as getStoredCookie,
  getModel,
  getPassword,
  getTheme,
  loadConnection,
  saveCookie,
  saveModel,
} from '../lib/connection';
import { DEFAULT_PROFILE } from '../lib/constants';
import { dismissNotification } from '../lib/notifications';
import { askKey, pendingAsks } from '../lib/ask-inbox';
import type { AskInboxEntry, AskOwner } from '../lib/ask-inbox';
import { GatewayWs } from '../lib/gateway-ws';
import type { ConnState, HistoryMessage } from '../lib/gateway-ws';
import { errMsg, nid } from '../utils/messages';
import type { Attachment, UiMessage } from '../utils/messages';
import type { Role } from '../utils/messages';
import {
  discoverAgentProfiles,
  historyToItems,
  mergeUsageState,
  normalizeProfileName,
  profileSessionKey,
  scheduleContextHydration,
  withTimeout,
} from './helpers';
import type { AgentProfile, AppStore, ScopedSessionSummary } from './types';
import { useThemeSlice } from './slices/useTheme';
import { useNotificationsSlice } from './slices/useNotifications';
import { useQueueSlice } from './slices/useQueue';
import { useModelsSlice } from './slices/useModels';
import { useSessionInfoSlice } from './slices/useSessionInfo';
import { useLiveRosterSlice } from './slices/useLiveRoster';
import { useComposerSlice } from './slices/useComposer';
import { useSessionsSlice } from './slices/useSessions';
import { useAskInboxSlice } from './slices/useAskInbox';
import { useAskRepliesSlice } from './slices/useAskReplies';
import { useNotificationResponsesSlice } from './slices/useNotificationResponses';
import { useToolRefreshSlice } from './slices/useToolRefresh';
import { useLiveTurnSlice } from './slices/useLiveTurn';
import { useCommandsSlice } from './slices/useCommands';
import { useStoreRuntime } from './runtime';
import { useGatewaySlice } from './slices/useGateway';
import { useConnectionSlice } from './slices/useConnection';
import { useSessionOpsSlice } from './slices/useSessionOps';
import { useProfileOpsSlice } from './slices/useProfileOps';
import { useTurnSlice } from './slices/useTurn';

const AppContext = createContext<AppStore | null>(null);


export function useApp(): AppStore {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPasswordState] = useState('');
  const passwordScopeRef = useRef('');
  const setPasswordForScope = useCallback((value: string, scope: string) => {
    setPasswordState(value);
    passwordScopeRef.current = value ? scope : '';
  }, []);
  const setPassword = useCallback(
    (value: string) => {
      setPasswordForScope(value, value ? connectionScope(host, username) : '');
    },
    [host, username, setPasswordForScope],
  );
  const [rememberPw] = useState(true);
  useEffect(() => {
    const nextScope = connectionScope(host, username);
    if (passwordScopeRef.current && passwordScopeRef.current !== nextScope) {
      passwordScopeRef.current = '';
      setPasswordState('');
    }
  }, [host, username]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conn, setConn] = useState<ConnState>('idle');
  const [activeProfile, setActiveProfile] = useState(DEFAULT_PROFILE);
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [authed, setAuthed] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null); // stored DB id — stable across resumes
  const [sessionTitle, setSessionTitle] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [toolLine, setToolLine] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  const { themeMode, theme, setTheme, hydrateTheme } = useThemeSlice();
  // Local notifications (turn complete / server asks while backgrounded).
  const { notifyEnabled, notifyRef, setNotifications, loadNotifications } = useNotificationsSlice();

  // Shared runtime refs (also consumed by store slices).
  const runtime = useStoreRuntime();
  const {
    gw,
    cookie,
    cookieScope,
    activeProfileRef,
    activeProfilePreferenceRef,
    profileEpochRef,
    connectionEpochRef,
    connectRequestRef,
    logoutCleanupRef,
    sessionOpenEpochRef,
    runtimeOwners,
    runtimeAskOwners,
    generatingRef,
    sendRef,
    drainRef,
    messagesRef,
    profilesRef,
    sessionIdRef,
    editingRowRef: editRowRef,
    uploadingRef: uploading,
    contextHydrateCancelRef,
    contextPendingSidRef,
    stampRowIdsRef,
    resyncRef,
    connectRef,
    openSessionRef,
    newSessionRef,
    stopRef,
    renameSessionRef,
    releaseLocalTurnRef,
  } = runtime;
  activeProfileRef.current = activeProfile;
  profilesRef.current = profiles;
  const { todos, setTodos, subagents, setSubagents } = useLiveRosterSlice({ runtime, generating, sessionId });
  const { catalogAtRef, loadCommandsCatalog } = useCommandsSlice({ runtime, sessionId });
  const {
    sessions,
    setSessions,
    sessionsLimit,
    setSessionsLimit,
    sessionsHasMore,
    setSessionsHasMore,
    sessionsLoadingMore,
    setSessionsLoadingMore,
    sessionsLimitRef,
    sessionsHasMoreRef,
    sessionsLoadingMoreRef,
    sessionsFetchRef,
    sessionsFetchProfileRef,
    refreshSessions,
    loadMoreSessions,
  } = useSessionsSlice({ runtime, setError });
  const acceptRotatedCookie = useCallback(
    async (
      nextCookie: string,
      targetHost: string,
      targetUser: string,
      expectedConnectionEpoch: number,
      expectedProfileEpoch: number,
    ) => {
      if (connectionEpochRef.current !== expectedConnectionEpoch || profileEpochRef.current !== expectedProfileEpoch)
        return;
      cookie.current = nextCookie;
      cookieScope.current = connectionScope(targetHost, targetUser);
      await saveCookie(nextCookie, targetHost, targetUser);
    },
    [],
  );
  const refreshProfiles = useCallback(async () => {
    if (!host || !cookie.current) return;
    const connectionEpoch = connectionEpochRef.current;
    const profileEpoch = profileEpochRef.current;
    const targetHost = host;
    const targetUser = username;
    const targetCookie = cookie.current;
    try {
      const discovered = await discoverAgentProfiles(targetHost, targetCookie, async (nextCookie) => {
        if (latest.current.host !== targetHost || latest.current.username !== targetUser) return;
        await acceptRotatedCookie(nextCookie, targetHost, targetUser, connectionEpoch, profileEpoch);
      });
      if (
        connectionEpochRef.current !== connectionEpoch ||
        profileEpochRef.current !== profileEpoch ||
        latest.current.host !== targetHost ||
        latest.current.username !== targetUser
      )
        return;
      setProfiles(discovered.profiles);
    } catch {}
  }, [acceptRotatedCookie, host, username]);
  // Live runtime session id for callbacks frozen in openWs (reconnect replay).
  sessionIdRef.current = sessionId;
  const {
    infoOpen,
    setInfoOpen,
    infoSeq,
    setInfoSeq,
    sessionInfo,
    setSessionInfo,
    usageInfo,
    setUsageInfo,
    usageLoading,
    setUsageLoading,
    usageRefreshRef,
    openInfo,
  } = useSessionInfoSlice({ runtime, activeProfile, sessionId, sessionIdRef });
  const {
    queued,
    queueParked,
    queuedRef,
    queueParkedRef,
    setQueued,
    setQueueParked,
    setQueue,
    enqueueQueued,
    removeQueued,
    clearQueue,
    resumeQueue,
    sendQueuedNow,
  } = useQueueSlice({ generatingRef, sendRef, drainRef });
  generatingRef.current = generating;
  messagesRef.current = messages;
  // Latest host/profile/sessionKey for callbacks frozen in openWs (created once).
  const latest = useRef({ host, username, activeProfile, sessionKey });
  latest.current = { host, username, activeProfile, sessionKey };
  const {
    streamingTexts,
    setStreamingTexts,
    streamingRef,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    liveTurnDiffs,
    turnOwnerRef,
    parkedLiveRef,
    lastTurnEventAt,
    clearStreaming,
    parkLiveTurn,
    reanchorLiveTurn,
  } = useLiveTurnSlice({ runtime, latest, sessionIdRef });

  const {
    model,
    modelProvider,
    effort,
    providers,
    providersLoading,
    providersError,
    setModel,
    setModelProvider,
    setEffort,
    setProviders,
    setProvidersLoading,
    setProvidersError,
    providersRef,
    providersLoadingRef,
    providersAtRef,
    loadProviders,
    pickModel,
    applyEffort,
    applyFast,
    applyApprovalMode,
  } = useModelsSlice({
    runtime,
    host,
    username,
    activeProfile,
    sessionId,
    acceptRotatedCookie,
    setMessages,
    setToolLine,
    latest,
  });
  const {
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
  } = useAskInboxSlice({ runtime, profilesRef, latest, sessionIdRef });

  const { toolRefreshRef, scheduleToolRefresh, refreshToolResults } = useToolRefreshSlice({
    runtime,
    latest,
    acceptRotatedCookie,
    setMessages,
  });
  // Stamp durable row ids onto live messages (edit/rewind targets) by aligning
  // the REST transcript tail with the local transcript from the end.
  stampRowIdsRef.current = () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const targetUser = latest.current.username;
    if (!h || !sk) return;
    void (async () => {
      try {
        const items = await getSessionMessages(
          h,
          cookie.current,
          sk,
          profile,
          200,
          connectionScope(h, targetUser),
          async (nextCookie) => acceptRotatedCookie(nextCookie, h, targetUser, connectionEpoch, epoch),
        );
        if (
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch ||
          connectionEpochRef.current !== connectionEpoch ||
          latest.current.sessionKey !== sk
        )
          return;
        const rest = items.filter(
          (m) => (m.role === 'user' || m.role === 'assistant') && m.rowId != null && m.content.trim(),
        );
        if (!rest.length) return;
        const fill = new Map<string, number>();
        let j = rest.length - 1;
        const ours = messagesRef.current;
        for (let i = ours.length - 1; i >= 0 && j >= 0; i--) {
          const m = ours[i];
          if (m.role !== 'user' && m.role !== 'assistant') continue;
          while (j >= 0 && !(rest[j].role === m.role && rest[j].content.trim() === m.text.trim())) j--;
          if (j < 0) break;
          if (m.rowId == null && rest[j].rowId != null) fill.set(m.id, rest[j].rowId as number);
          j--;
        }
        if (!fill.size) return;
        setMessages((prev) => prev.map((m) => (fill.has(m.id) ? { ...m, rowId: fill.get(m.id) } : m)));
      } catch {}
    })();
  };
  // Post-reconnect resync: the replay ring had already dropped the gap, so the
  // transcript must be rebuilt from REST rather than trusted piecemeal.
  resyncRef.current = () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const targetUser = latest.current.username;
    const runtime = sessionIdRef.current;
    if (!h || !sk || !runtime) return;
    void (async () => {
      try {
        const hist = await getSessionMessages(
          h,
          cookie.current,
          sk,
          profile,
          200,
          connectionScope(h, targetUser),
          async (nextCookie) => acceptRotatedCookie(nextCookie, h, targetUser, connectionEpoch, epoch),
        );
        if (
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch ||
          connectionEpochRef.current !== connectionEpoch ||
          latest.current.sessionKey !== sk ||
          sessionIdRef.current !== runtime
        )
          return;
        if (hist.length) {
          const items = historyToItems(hist);
          clearStreaming();
          if (generatingRef.current) {
            // Rebuild dropped the live bubble — re-anchor so streaming continues.
            setMessages(reanchorLiveTurn(items));
            lastTurnEventAt.current = Date.now();
          } else {
            setMessages(items);
          }
          setToolLine(null);
        }
      } catch {}
    })();
  };

  const hydrateSessionContext = useCallback((g: GatewayWs, sid: string) => {
    contextHydrateCancelRef.current?.();
    contextPendingSidRef.current = sid;
    contextHydrateCancelRef.current = scheduleContextHydration(
      g,
      sid,
      () => sessionIdRef.current === sid,
      (snapshot) => {
        if (contextPendingSidRef.current === sid) contextPendingSidRef.current = null;
        setUsageInfo((prev: any) => mergeUsageState(prev, snapshot));
      },
    );
  }, []);


  const {
    input,
    inputRaw,
    setInput,
    setInputRaw,
    draftsRef,
    draftKeyRef,
    attachments,
    setAttachments,
    copiedId,
    copyText,
  } = useComposerSlice({ activeProfile, sessionKey, sessionId });
  const [booting, setBooting] = useState(true);
  const {
    respondToInbox,
    answerInboxValue,
    answerInboxApproval,
    openAskEntry,
    answerAsk,
    answerValue,
    answerApproval,
    dismissAsk,
    confirmSensitiveNotification,
  } = useAskRepliesSlice({
    runtime,
    askRef,
    askInboxRef,
    setAsk,
    markAskStatus,
    latest,
    sessionIdRef,
    openSessionRef,
    setError,
  });
  const {
    pendingNotificationResponsesRef,
    notificationDrainRef,
    notificationActionInFlightRef,
    askHydrationRef,
    handledNotificationResponsesRef,
    queueNotificationResponse,
    clearQueuedNotificationResponse,
    handleNotificationResponse,
    drainPendingNotificationResponse,
  } = useNotificationResponsesSlice({
    runtime,
    askInboxRef,
    answerInboxApproval,
    answerInboxValue,
    openAskEntry,
    respondToInbox,
    confirmSensitiveNotification,
    latest,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await loadConnection();
        if (Platform.OS === 'web') await clearPassword(c.host, c.username);
        if (cancelled) return;
        setHost(c.host);
        setUsername(c.username);
        // Prefill saved password so the user never retypes it.
        const savedPw = await getPassword(c.host, c.username).catch(() => null);
        if (cancelled) return;
        const accountScope = connectionScope(c.host, c.username);
        if (savedPw) setPasswordForScope(savedPw, accountScope);
        const savedProfile = await getActiveProfile(accountScope).catch(() => null);
        if (savedProfile) {
          const normalized = normalizeProfileName(savedProfile);
          activeProfilePreferenceRef.current = normalized;
          activeProfileRef.current = normalized;
          setActiveProfile(normalized);
        }
        // Restore the saved preference before releasing the splash gate.
        const savedTheme = await getTheme().catch(() => null);
        if (cancelled) return;
        hydrateTheme(savedTheme);
        // Restore the local-notifications preference.
        await loadNotifications(() => cancelled);
        // Restore the last picked model so the composer chip survives restarts
        // (the server global default still governs actual runs).
        const savedModel = await getModel(activeProfileRef.current, accountScope).catch(() => null);
        if (!cancelled && savedModel) {
          if (savedModel.provider) setModelProvider(savedModel.provider);
          setModel(savedModel.model);
        }
        // Silent reconnect — restore the session without asking login again.
        // Hard ceiling: even a totally wedged connect must release the boot
        // gate so the user gets the login form instead of a dead spinner.
        if (c.hasCookie && c.username && c.host.trim()) {
          try {
            await withTimeout(connectRef.current(c.host, c.username, savedPw ?? ''), 90000, 'connect timed out');
          } catch (e) {
            setError(errMsg(e));
          }
        }
      } catch {
        // Fall through to the login screen (connect already set the error).
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
      gw.current?.close();
    };
  }, []);

  // ── Connect pipeline ─────────────────────────────────────────────────────

  const ensureCookie = useCallback(
    async (h: string, user: string, pw: string, isCurrent: () => boolean = () => true): Promise<string> => {
      const scope = connectionScope(h, user);
      if (cookieScope.current !== scope) {
        cookie.current = '';
        cookieScope.current = '';
      }
      if (!isCurrent()) throw new Error('Connection superseded');
      const updateCookie = async (nextCookie: string) => {
        if (!isCurrent()) return;
        cookie.current = nextCookie;
        cookieScope.current = scope;
        await saveCookie(nextCookie, h, user);
      };

      if (cookie.current) {
        try {
          if (await checkMe(h, cookie.current, updateCookie)) {
            if (!isCurrent()) throw new Error('Connection superseded');
            cookieScope.current = scope;
            return cookie.current;
          }
        } catch (e) {
          if (!isCurrent()) throw e;
        }
        cookie.current = '';
        cookieScope.current = '';
        await clearCookie(h, user);
      }

      const stored = await getStoredCookie(h, user);
      if (!isCurrent()) throw new Error('Connection superseded');
      if (stored) {
        try {
          if (await checkMe(h, stored, updateCookie)) {
            if (!isCurrent()) throw new Error('Connection superseded');
            cookie.current = stored;
            cookieScope.current = scope;
            return stored;
          }
        } catch (e) {
          if (!isCurrent()) throw e;
        }
      }
      if (!isCurrent()) throw new Error('Connection superseded');
      if (!pw) throw new Error('Session expired — enter password');
      const fresh = await passwordLogin(h, user, pw);
      if (!isCurrent()) throw new Error('Connection superseded');
      cookie.current = fresh;
      cookieScope.current = scope;
      await saveCookie(fresh, h, user);
      return fresh;
    },
    [],
  );


  const { openWs, probeWorkingSessions } = useGatewaySlice({
    runtime,
    latest,
    hydrateSessionContext,
    releaseLocalTurnRef,
    askHydrationRef,
    notificationDrainRef,
    pendingNotificationResponsesRef,
    handledNotificationResponsesRef,
    askInboxRef,
    askRef,
    setAskInbox,
    setAsk,
    bindAskOwner,
    resolveAskOwner,
    applyAskInbox,
    markAskByRpc,
    dismissAskNotifications,
    draftsRef,
    setInputRaw,
    setAttachments,
    queuedRef,
    setQueued,
    queueParkedRef,
    setQueueParked,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    liveTurnDiffs,
    streamingRef,
    setStreamingTexts,
    turnOwnerRef,
    parkedLiveRef,
    lastTurnEventAt,
    notifyRef,
    usageRefreshRef,
    setUsageInfo,
    setSessionInfo,
    toolRefreshRef,
    scheduleToolRefresh,
    setTodos,
    setModel,
    setModelProvider,
    setConn,
    setAuthed,
    setProfiles,
    setActiveProfile,
    setError,
    setToolLine,
    setSessionId,
    setSessionKey,
    setMessages,
    setSessions,
    setGenerating,
    setPassword,
    setProviders,
  });

  const { connect, login, logout } = useConnectionSlice({
    runtime,
    latest,
    providersRef,
    acceptRotatedCookie,
    ensureCookie,
    openWs,
    refreshSessions,
    rememberPw,
    passwordScopeRef,
    host,
    username,
    password,
    dismissAskNotifications,
    setAskInbox,
    setAsk,
    askRef,
    askInboxRef,
    handledNotificationResponsesRef,
    pendingNotificationResponsesRef,
    askHydrationRef,
    notificationActionInFlightRef,
    turnOwnerRef,
    parkedLiveRef,
    draftsRef,
    queuedRef,
    queueParkedRef,
    liveAid,
    liveThinkAid,
    clearStreaming,
    sessionsFetchRef,
    sessionsFetchProfileRef,
    setInputRaw,
    setPassword,
    setQueued,
    setQueueParked,
    setProviders,
    setProfiles,
    setActiveProfile,
    setBusy,
    setError,
    setModel,
    setModelProvider,
    setAuthed,
    setConn,
    setSessionId,
    setSessionKey,
    setMessages,
    setSessions,
    setSessionInfo,
    setUsageInfo,
    setGenerating,
    setToolLine,
    setTodos,
    setSubagents,
    setAttachments,
    setEditingRowId,
    setInfoOpen,
  });
  connectRef.current = connect;

  // ── Sessions ─────────────────────────────────────────────────────────────

  const { openSession, newSession } = useSessionOpsSlice({
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
  });


  const { switchProfile, branchSession } = useProfileOpsSlice({
    runtime,
    latest,
    host,
    username,
    sessionId,
    inputRaw,
    profiles,
    refreshProfiles,
    refreshSessions,
    parkLiveTurn,
    clearStreaming,
    hydrateSessionContext,
    bindAskOwner,
    draftsRef,
    draftKeyRef,
    queuedRef,
    queueParkedRef,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    liveTurnDiffs,
    sessionsLoadingMoreRef,
    providersRef,
    providersLoadingRef,
    providersAtRef,
    catalogAtRef,
    sessionsFetchRef,
    sessionsFetchProfileRef,
    setError,
    setBusy,
    setActiveProfile,
    setSessionId,
    setSessionKey,
    setSessionTitle,
    setMessages,
    setGenerating,
    setToolLine,
    setQueued,
    setQueueParked,
    setAttachments,
    setTodos,
    setSubagents,
    setAsk,
    setEditingRowId,
    setInfoOpen,
    setInputRaw,
    setSessionInfo,
    setUsageInfo,
    setUsageLoading,
    setOpeningId,
    setSessions,
    setSessionsLimit,
    setSessionsHasMore,
    setSessionsLoadingMore,
    setProviders,
    setProvidersLoading,
    setProvidersError,
    setModel,
    setModelProvider,
  });

  // ── Chat ─────────────────────────────────────────────────────────────────
  // Scrolling lives in the chat screen (it owns the FlatList ref); send()
  // only queues state — the screen scrolls after calling it.

  // useCallback so Composer's memo() holds between streamed tokens (the deps
  // only move when the user actually types, attaches or a turn starts/ends).


  const {
    beginTurn,
    runSlash,
    editMessage,
    cancelEdit,
    regenerate,
    pasteLarge,
    send,
    releaseLocalTurn,
    stop,
  } = useTurnSlice({
    runtime,
    latest,
    queueParkedRef,
    activeProfile,
    sessionId,
    sessionKey,
    generating,
    input,
    attachments,
    setMessages,
    setSubagents,
    setGenerating,
    setToolLine,
    setSessionId,
    setEditingRowId,
    setInput,
    setQueueParked,
    setAttachments,
    enqueueQueued,
    bindAskOwner,
    clearStreaming,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    liveTurnDiffs,
    turnOwnerRef,
    parkedLiveRef,
    lastTurnEventAt,
  });

  // Watchdog: a missed turn-end (dropped complete, truncated replay, an error
  // notice instead of complete) must never strand the Stop button forever.
  // Desktop parity: confirm against `session.active_list` before releasing —
  // a still-live turn just snoozes. Releasing only the LOCAL latch is safe —
  // liveAid stays, so a late message.complete still finalizes the transcript.
  useEffect(() => {
    if (!generating || !sessionId) return;
    const watchedSessionId = sessionId;
    const watchedSessionKey = sessionKey;
    const t = setInterval(() => {
      if (!generatingRef.current) return;
      if (Date.now() - lastTurnEventAt.current < 180000) return;
      void (async () => {
        if (sessionIdRef.current !== watchedSessionId || latest.current.sessionKey !== watchedSessionKey) return;
        const working = await probeWorkingSessions();
        const sk = latest.current.sessionKey;
        const runtime = sessionIdRef.current;
        const cur = sk
          ? profileSessionKey(latest.current.activeProfile, sk)
          : runtime
            ? (runtimeOwners.current.get(runtime) ?? profileSessionKey(latest.current.activeProfile, runtime))
            : null;
        if (working && cur && working.has(cur)) {
          lastTurnEventAt.current = Date.now(); // still alive — snooze
          return;
        }
        // Gone (or old backend with no confirm producer) — release.
        if (cur) parkedLiveRef.current.delete(cur);
        releaseLocalTurnRef.current();
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: 'No updates for a while — released the stop button. The reply will still land if the agent is working.',
          },
        ]);
      })();
    }, 10000);
    return () => clearInterval(t);
  }, [generating, sessionId, sessionKey, releaseLocalTurn, probeWorkingSessions]);
  stopRef.current = stop;

  // ── Ask replies ──────────────────────────────────────────────────────────


  // ── Session management / steering / model defaults ─────────────────────

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

  const getGw = useCallback(() => gw.current, []);
  const diagnostics = useCallback(
    () => ({
      conn,
      host,
      profile: activeProfile,
      profiles: profiles.map((profile) => profile.name),
      sessionId,
      sessionKey,
      model,
      provider: modelProvider,
      effort,
      queued: queued.length,
      pendingAsks: pendingAsks(askInbox).length,
      ws: gw.current?.wsDebug() ?? null,
    }),
    [conn, host, activeProfile, profiles, sessionId, sessionKey, model, modelProvider, effort, queued.length, askInbox],
  );
  const getCookie = useCallback(() => cookie.current, []);
  const getAuthScope = useCallback(() => `${connectionEpochRef.current}:${profileEpochRef.current}`, []);

  const opsGet = useCallback(
    async (path: string) => {
      const scope = getAuthScope();
      const targetHost = host;
      const targetUser = username;
      const requestCookie = cookie.current;
      const onCookie = async (nextCookie: string) => {
        if (getAuthScope() !== scope) return;
        cookie.current = nextCookie;
        cookieScope.current = connectionScope(targetHost, targetUser);
        await saveCookie(nextCookie, targetHost, targetUser);
      };
      const result = await dashboardOpsGet(targetHost, requestCookie, path, onCookie);
      if (getAuthScope() !== scope) throw new Error('Connection superseded');
      return result;
    },
    [getAuthScope, host, username],
  );
  const opsMut = useCallback(
    async (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => {
      const scope = getAuthScope();
      const targetHost = host;
      const targetUser = username;
      const requestCookie = cookie.current;
      const onCookie = async (nextCookie: string) => {
        if (getAuthScope() !== scope) return;
        cookie.current = nextCookie;
        cookieScope.current = connectionScope(targetHost, targetUser);
        await saveCookie(nextCookie, targetHost, targetUser);
      };
      const result = await dashboardOpsMut(targetHost, requestCookie, path, method, body, onCookie);
      if (getAuthScope() !== scope) throw new Error('Connection superseded');
      return result;
    },
    [getAuthScope, host, username],
  );

  const value: AppStore = useMemo(
    () => ({
      booting,
      authed,
      busy,
      error,
      host,
      setHost,
      username,
      setUsername,
      password,
      setPassword,
      conn,
      activeProfile,
      profiles,
      refreshProfiles,
      switchProfile,
      sessions,
      openingId,
      sessionId,
      sessionKey,
      sessionTitle,
      messages,
      streamingTexts,
      input,
      setInput,
      model,
      modelProvider,
      effort,
      applyEffort,
      applyFast,
      providers,
      providersLoading,
      providersError,
      attachments,
      setAttachments,
      generating,
      copiedId,
      infoOpen,
      setInfoOpen,
      infoSeq,
      sessionInfo,
      usageInfo,
      usageLoading,
      toolLine,
      ask,
      askInbox,
      pendingAskCount: pendingAsks(askInbox).length,
      openAskEntry,
      answerInboxApproval,
      connect,
      login,
      logout,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      sessionsLoadingMore,
      openSession,
      newSession,
      send,
      stop,
      openInfo,
      loadProviders,
      loadCommandsCatalog,
      queued,
      queueParked,
      enqueueQueued,
      removeQueued,
      clearQueue,
      resumeQueue,
      sendQueuedNow,
      editingRowId,
      editMessage,
      cancelEdit,
      regenerate,
      pasteLarge,
      applyApprovalMode,
      branchSession,
      notificationsEnabled: notifyEnabled,
      setNotifications,
      todos,
      subagents,
      refreshToolResults,
      pickModel,
      copyText,
      answerValue,
      answerApproval,
      answerAsk,
      dismissAsk,
      theme,
      themeMode,
      setTheme,
      renameSession,
      deleteSessionById,
      redirectLive,
      setGlobalModel,
      opsGet,
      opsMut,
      getGw,
      diagnostics,
      getCookie,
      getAuthScope,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      booting,
      authed,
      busy,
      error,
      host,
      username,
      password,
      conn,
      activeProfile,
      profiles,
      refreshProfiles,
      switchProfile,
      sessions,
      openingId,
      sessionId,
      sessionKey,
      sessionTitle,
      messages,
      streamingTexts,
      input,
      setInput,
      model,
      modelProvider,
      effort,
      applyEffort,
      applyFast,
      providers,
      providersLoading,
      providersError,
      attachments,
      generating,
      copiedId,
      infoOpen,
      infoSeq,
      sessionInfo,
      usageInfo,
      usageLoading,
      toolLine,
      ask,
      askInbox,
      openAskEntry,
      answerInboxApproval,
      connect,
      login,
      logout,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      sessionsLoadingMore,
      openSession,
      newSession,
      send,
      stop,
      openInfo,
      loadProviders,
      loadCommandsCatalog,
      queued,
      queueParked,
      enqueueQueued,
      removeQueued,
      clearQueue,
      resumeQueue,
      sendQueuedNow,
      editingRowId,
      editMessage,
      cancelEdit,
      regenerate,
      pasteLarge,
      applyApprovalMode,
      branchSession,
      notifyEnabled,
      setNotifications,
      todos,
      subagents,
      refreshToolResults,
      pickModel,
      copyText,
      answerValue,
      answerApproval,
      answerAsk,
      dismissAsk,
      theme,
      themeMode,
      setTheme,
      renameSession,
      deleteSessionById,
      redirectLive,
      setGlobalModel,
      opsGet,
      opsMut,
      getGw,
      diagnostics,
      getCookie,
      getAuthScope,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
