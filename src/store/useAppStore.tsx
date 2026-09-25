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
  clearSessionMessagesCache,
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
  saveActiveProfile,
  saveCookie,
  saveLastSession,
  saveModel,
} from '../lib/connection';
import { clearMediaCaches } from '../lib/media-cache';
import { DEFAULT_PROFILE } from '../lib/constants';
import { dismissNotification } from '../lib/notifications';
import { askKey, pendingAsks } from '../lib/ask-inbox';
import type { AskInboxEntry, AskOwner } from '../lib/ask-inbox';
import { GatewayWs } from '../lib/gateway-ws';
import type { ConnState, HistoryMessage } from '../lib/gateway-ws';
import { errMsg, isSlashCommand, nid, parseSlashCommand, utf8ToBase64 } from '../utils/messages';
import { slashBlockedMessage, slashMobileAction, slashMobileHint } from '../utils/slash-commands';
import type { Attachment, UiMessage } from '../utils/messages';
import { normalizeTodos } from '../utils/messages';
import type { Role } from '../utils/messages';
import {
  cutsWholeTranscript,
  discoverAgentProfiles,
  historyToItems,
  isImageAttachment,
  mergeUsageState,
  normalizeProfileName,
  profileSessionKey,
  scheduleContextHydration,
  serverAskFromInbox,
  uploadAttachments,
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
        let hist: HistoryMessage[];
        try {
          // Gate on the cookie ONLY as a fallback signal: on web the jar is empty
          // (JS can't read Set-Cookie) while the browser cookie still authenticates
          // via `credentials: 'include'`, so always try REST.
          hist = await getSessionMessages(
            targetHost,
            cookie.current,
            s.id,
            profile,
            200,
            connectionScope(targetHost, targetUser),
            async (nextCookie) => acceptRotatedCookie(nextCookie, targetHost, targetUser, connectionEpoch, epoch),
          );
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
              setUsageInfo((prev: any) => mergeUsageState(prev, info));
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
    [acceptRotatedCookie, hydrateSessionContext, bindAskOwner],
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
  }, [model, modelProvider, effort, bindAskOwner]);
  newSessionRef.current = newSession;

  const switchProfile = useCallback(
    async (profileName: string) => {
      const next = normalizeProfileName(profileName);
      if (next === activeProfileRef.current) return;
      if (profiles.length > 0 && !profiles.some((profile) => profile.name === next)) {
        setError(`Profile "${next}" is no longer available`);
        void refreshProfiles();
        return;
      }
      const g = gw.current;
      if (!g) {
        setError('Not connected — please login again');
        return;
      }

      setBusy(true);
      setError(null);
      // Preserve the outgoing profile's unsent text, then park any live turn.
      // The old runtime/socket stays alive; only the foreground workspace moves.
      if (draftKeyRef.current) draftsRef.current.set(draftKeyRef.current, inputRaw);
      parkLiveTurn();
      const epoch = ++profileEpochRef.current;
      clearMediaCaches();
      clearSessionMessagesCache();
      activeProfilePreferenceRef.current = next;
      activeProfileRef.current = next;
      setActiveProfile(next);
      void saveActiveProfile(next, connectionScope(host, username));

      sessionIdRef.current = null;
      contextHydrateCancelRef.current?.();
      contextHydrateCancelRef.current = null;
      contextPendingSidRef.current = null;
      setSessionId(null);
      setSessionKey(null);
      setSessionTitle('');
      setMessages([]);
      clearStreaming();
      liveAid.current = null;
      liveThinkAid.current = null;
      liveTools.current.clear();
      liveToolAid.current = null;
      liveTurnTools.current = [];
      liveTurnDiffs.current = [];
      setSessions([]);
      setOpeningId(null);
      setGenerating(false);
      generatingRef.current = false;
      setQueued([]);
      queuedRef.current = [];
      setQueueParked(false);
      queueParkedRef.current = false;
      setAttachments([]);
      setSessionInfo(null);
      setUsageInfo(null);
      setUsageLoading(false);
      setTodos([]);
      setSubagents([]);
      setAsk(null);
      setToolLine(null);
      setEditingRowId(null);
      editRowRef.current = null;
      setInfoOpen(false);
      setInputRaw('');
      draftKeyRef.current = `${next}::__none__`;
      sessionsFetchRef.current = null;
      sessionsFetchProfileRef.current = null;
      setSessionsLimit(100);
      setSessionsHasMore(true);
      sessionsLoadingMoreRef.current = false;
      setSessionsLoadingMore(false);
      providersRef.current = null;
      providersLoadingRef.current = false;
      setProvidersLoading(false);
      providersAtRef.current = 0;
      catalogAtRef.current = 0;
      setProviders(null);
      setProvidersError(null);

      const info = profiles.find((profile) => profile.name === next);
      const remembered = await getModel(next, connectionScope(host, username)).catch(() => null);
      if (activeProfileRef.current !== next || profileEpochRef.current !== epoch) return;
      setModel(String(remembered?.model ?? info?.model ?? ''));
      setModelProvider(String(remembered?.provider ?? info?.provider ?? ''));

      try {
        await refreshSessions(100);
        if (activeProfileRef.current !== next || profileEpochRef.current !== epoch) return;
        await newSessionRef.current();
      } catch (e) {
        if (activeProfileRef.current === next && profileEpochRef.current === epoch) {
          setError(errMsg(e));
        }
      } finally {
        if (activeProfileRef.current === next && profileEpochRef.current === epoch) {
          setBusy(false);
          router.replace('/chat');
        }
      }
    },
    [inputRaw, parkLiveTurn, clearStreaming, profiles, refreshProfiles, refreshSessions, host, username],
  );

  // Fork the current chat into an independent copy (session.branch) and open it.
  const branchSession = useCallback(async () => {
    const g = gw.current;
    const sid = sessionId;
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    const connectionEpoch = connectionEpochRef.current;
    if (!g || !sid) return;
    // Branching abandons the live runtime — same stranded-latch guard as openSession.
    parkLiveTurn();
    liveAid.current = null;
    liveThinkAid.current = null;
    setGenerating(false);
    generatingRef.current = false;
    setToolLine(null);
    try {
      const r: any = await g.branchSession(sid);
      const liveId = String(r?.session_id ?? '');
      if (!liveId) return;
      if (
        connectionEpochRef.current !== connectionEpoch ||
        activeProfileRef.current !== profile ||
        profileEpochRef.current !== epoch
      )
        return;
      const hist: HistoryMessage[] = (Array.isArray(r?.messages) ? r.messages : []).map((m: any) => ({
        role: String(m?.role ?? ''),
        content: String(m?.text ?? m?.content ?? ''),
        ...(typeof m?.row_id === 'number' ? { rowId: m.row_id } : {}),
        ...(typeof m?.timestamp === 'number' ? { ts: m.timestamp } : {}),
        ...(m?.reasoning ? { reasoning: String(m.reasoning) } : {}),
        ...(typeof m?.name === 'string' ? { name: m.name } : {}),
      }));
      const branchKey = String(r?.stored_session_id || liveId);
      const owner = profileSessionKey(profile, branchKey);
      runtimeOwners.current.set(liveId, owner);
      bindAskOwner(liveId, {
        connectionId: connectionScope(latest.current.host, latest.current.username),
        profile,
        storedSessionId: branchKey,
        runtimeSessionId: liveId,
        resolved: true,
      });
      setSessionKey(branchKey);
      void saveLastSession(branchKey, profile, connectionScope(latest.current.host, latest.current.username));
      sessionIdRef.current = liveId;
      setSessionId(liveId);
      setSessionTitle(String(r?.title ?? ''));
      setMessages(historyToItems(hist));
      clearStreaming();
      queuedRef.current = [];
      setQueued([]);
      editRowRef.current = null;
      setEditingRowId(null);
      setTodos([]);
      setSubagents([]);
      setAttachments([]);
      const branchInfo = r?.info && typeof r.info === 'object' && !Array.isArray(r.info) ? r.info : null;
      setSessionInfo(branchInfo);
      setUsageInfo(branchInfo?.usage ?? null);
      void g
        .usage(liveId)
        .then((info) => {
          if (connectionEpochRef.current === connectionEpoch && sessionIdRef.current === liveId) {
            setUsageInfo((prev: any) => mergeUsageState(prev, info));
          }
        })
        .catch(() => {});
      hydrateSessionContext(g, liveId);
      draftKeyRef.current = owner;
      setInputRaw(draftsRef.current.get(owner) ?? '');
      router.push('/chat');
    } catch (e: any) {
      if (
        connectionEpochRef.current === connectionEpoch &&
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch
      ) {
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Branch failed: ${errMsg(e)}` }]);
      }
    }
  }, [sessionId, hydrateSessionContext]);

  // ── Chat ─────────────────────────────────────────────────────────────────
  // Scrolling lives in the chat screen (it owns the FlatList ref); send()
  // only queues state — the screen scrolls after calling it.

  // useCallback so Composer's memo() holds between streamed tokens (the deps
  // only move when the user actually types, attaches or a turn starts/ends).

  // Start an agent turn: echo the user line (when this call owns it), pin the
  // pending assistant bubble, submit, and recover from an expired live runtime.
  // Shared by send() and the slash dispatches that expand to a prompt (skills,
  // bundles, /bg-style sends).
  const beginTurn = useCallback(
    async (
      submitText: string,
      echo?: { text: string; media?: Attachment[] },
      rewindRowId?: number,
      confirmEmptyTruncate?: boolean,
    ) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      if (!g || !sid) return;
      const submitOpts =
        rewindRowId != null
          ? {
              rewindRowId,
              ...(confirmEmptyTruncate ? { confirmEmptyTruncate: true } : {}),
            }
          : {};
      const roomKey = sessionKey ?? sid ?? '';
      const owner = profileSessionKey(profile, roomKey);
      const sameRoom = () => {
        if (
          connectionEpochRef.current !== connectionEpoch ||
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch
        )
          return false;
        const currentRuntime = sessionIdRef.current;
        if (!currentRuntime) return false;
        return runtimeOwners.current.get(currentRuntime) === owner || latest.current.sessionKey === roomKey;
      };
      turnOwnerRef.current.set(sid, owner);
      runtimeOwners.current.set(sid, owner);
      bindAskOwner(sid, {
        connectionId: connectionScope(latest.current.host, latest.current.username),
        profile,
        storedSessionId: sessionKey ?? sid,
        runtimeSessionId: sid,
        resolved: true,
      });
      // Rewind: the server cuts history at that user row, so drop the matching
      // local tail first (and re-echo the user line for regenerate, which passes
      // no explicit echo).
      if (rewindRowId != null) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.rowId === rewindRowId);
          return idx >= 0 ? prev.slice(0, idx) : prev;
        });
      }
      if (echo) {
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'user' as Role,
            text: echo.text,
            ts: Math.floor(Date.now() / 1000),
            ...(echo.media?.length ? { media: echo.media } : {}),
          },
        ]);
      } else if (rewindRowId != null) {
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'user' as Role,
            text: submitText,
            ts: Math.floor(Date.now() / 1000),
          },
        ]);
      }
      const aid = nid();
      liveAid.current = aid;
      liveThinkAid.current = null; // fresh turn → fresh thinking bubble
      liveTools.current.clear();
      liveToolAid.current = null;
      liveTurnTools.current = [];
      liveTurnDiffs.current = [];
      clearStreaming();
      setSubagents([]);
      setMessages((prev) => [...prev, { id: aid, role: 'assistant', text: '', pending: true }]);
      setGenerating(true);
      generatingRef.current = true; // flip now: a drain before the re-render must not double-send
      lastTurnEventAt.current = Date.now();
      try {
        const status = await g.submit(sid, submitText, submitOpts);
        if (!sameRoom()) return;
        if (status === 'queued') setToolLine('queued — will run after the live turn…');
      } catch (e: any) {
        if (!sameRoom()) return;
        let msg = e?.message ?? String(e);
        let code = e?.code;
        // Live runtime expired server-side (orphan-reaped / evicted / idle TTL) —
        // resume the STORED session for a fresh live id and retry once.
        if ((code === 4001 || /not.?found/i.test(msg)) && sessionKey) {
          try {
            const r: any = await g.call('session.resume', {
              profile,
              session_id: sessionKey,
              omit_messages: false,
            });
            if (!sameRoom()) return;
            const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : sessionKey;
            runtimeOwners.current.set(liveId, owner);
            bindAskOwner(liveId, {
              connectionId: connectionScope(latest.current.host, latest.current.username),
              profile,
              storedSessionId: sessionKey,
              runtimeSessionId: liveId,
              resolved: true,
            });
            sessionIdRef.current = liveId;
            setSessionId(liveId);
            turnOwnerRef.current.delete(sid);
            turnOwnerRef.current.set(liveId, owner);
            runtimeOwners.current.set(liveId, owner);
            const status = await g.submit(liveId, submitText, submitOpts);
            if (!sameRoom()) return;
            if (status === 'queued') setToolLine('queued — will run after the live turn…');
            return;
          } catch (e2: any) {
            if (!sameRoom()) return;
            msg = e2?.message ?? String(e2);
            code = e2?.code;
          }
        }
        liveAid.current = null;
        setGenerating(false);
        generatingRef.current = false;
        if (code === 4009) {
          setMessages((prev) => [
            ...prev,
            {
              id: nid(),
              role: 'notice',
              text: `Session busy (${msg}). Stop the live turn and resend.`,
            },
          ]);
        } else {
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Send failed: ${msg}` }]);
        }
        setMessages((prev) => prev.filter((m) => m.id !== aid));
      }
    },
    [activeProfile, sessionId, sessionKey, setSessionId],
  );

  // Run a slash command server-side: slash.exec first (live shortcuts + worker),
  // falling back to command.dispatch for skill/quick/bundle commands (4018). The
  // worker result is either plain output text or a dispatch directive, handled
  // the way the desktop/TUI clients do (skills/bundles submit a prompt, /undo
  // drops text back into the composer).
  const runSlash = useCallback(
    async (raw: string) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      const roomKey = sessionKey ?? sid ?? '';
      const full = raw.trim();
      if (!g || !sid || generating || !full) return;
      const current = () =>
        connectionEpochRef.current === connectionEpoch &&
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch &&
        (sessionIdRef.current === sid ||
          runtimeOwners.current.get(sessionIdRef.current ?? '') === profileSessionKey(profile, roomKey));
      setMessages((prev) => [...prev, { id: nid(), role: 'user', text: full }]);
      const show = (text: string) => {
        if (current()) setMessages((prev) => [...prev, { id: nid(), role: 'assistant', text }]);
      };
      const fail = (text: string) => {
        if (current()) setMessages((prev) => [...prev, { id: nid(), role: 'notice', text }]);
      };

      // slash.exec refuses skill/quick/bundle commands with 4018 — reroute those
      // through command.dispatch, whose result is the structured directive.
      const exec = async (command: string): Promise<any> => {
        try {
          const r: any = await g.slashExec(sid, command);
          if (!current()) return null;
          if (r && typeof r === 'object' && typeof r.type === 'string') return r;
          const out = typeof r?.output === 'string' ? r.output.trim() : '';
          const warn = typeof r?.warning === 'string' ? r.warning.trim() : '';
          show([warn, out || '(no output)'].filter(Boolean).join('\n\n'));
          return null;
        } catch (e: any) {
          if (!current()) return null;
          if (e?.code === 4018 || e?.code === 4011) {
            const { name, arg } = parseSlashCommand(command);
            return g.commandDispatch(sid, name, arg);
          }
          throw e;
        }
      };

      const handle = async (d: any): Promise<void> => {
        if (!d || !current()) return;
        switch (d.type) {
          case 'exec':
          case 'plugin':
            show((typeof d.output === 'string' && d.output.trim()) || '(no output)');
            return;
          case 'alias': {
            const target = typeof d.target === 'string' ? d.target.trim() : '';
            if (!target) return;
            const { arg } = parseSlashCommand(full);
            const next = `/${target.replace(/^\/+/, '')}${arg ? ` ${arg}` : ''}`;
            const nested = await exec(next);
            if (nested) await handle(nested);
            return;
          }
          case 'skill':
          case 'send': {
            const message = typeof d.message === 'string' ? d.message : '';
            if (!message.trim()) {
              fail('command returned an empty message');
              return;
            }
            // runSlash already echoed the typed command, so no second user bubble.
            await beginTurn(message);
            return;
          }
          case 'prefill':
            if (typeof d.message === 'string' && current()) {
              setInput(d.message);
              if (d.notice) show(String(d.notice));
            }
            return;
          default:
            fail('command returned an unexpected response');
        }
      };

      const { name } = parseSlashCommand(full);
      setToolLine(`running /${name || 'command'}…`);
      let d: any = null;
      try {
        d = await exec(full);
      } catch (e: any) {
        if (!current()) return;
        setToolLine(null);
        fail(`/${name || 'command'}: ${errMsg(e)}`);
        return;
      }
      if (!current()) return;
      setToolLine(null);
      if (d) await handle(d);
    },
    [activeProfile, sessionId, sessionKey, generating, beginTurn, setInput],
  );

  // ── Edit / regenerate (rewind) ────────────────────────────────────────────
  // "Edit & resend" rewinds history to that user row and resubmits the edited
  // text; "Regenerate" reruns the last user turn. Both need the durable row id
  // (ordinal-only cuts are refused for durable sessions).

  const editMessage = useCallback(
    (id: string) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (!m || m.role !== 'user') return;
      if (m.rowId == null) {
        stampRowIdsRef.current();
        setMessages((prev) => [
          ...prev,
          {
            id: nid(),
            role: 'notice',
            text: 'Loading the message id — tap Edit again in a moment.',
          },
        ]);
        return;
      }
      editRowRef.current = m.rowId;
      setEditingRowId(m.rowId);
      setInput(m.text);
    },
    [setInput],
  );

  const cancelEdit = useCallback(() => {
    editRowRef.current = null;
    setEditingRowId(null);
    setInput('');
  }, [setInput]);

  const regenerate = useCallback(() => {
    const g = gw.current;
    if (!g || !sessionId || generatingRef.current) return;
    const list = messagesRef.current;
    const lastUser = [...list].reverse().find((m) => m.role === 'user' && m.rowId != null && m.text.trim());
    if (!lastUser) {
      setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: 'Nothing to regenerate yet.' }]);
      stampRowIdsRef.current();
      return;
    }
    void beginTurn(lastUser.text, undefined, lastUser.rowId as number, cutsWholeTranscript(list, lastUser.id));
  }, [sessionId, beginTurn]);

  // Large-paste handling: stage text in the active session workspace so it
  // follows the selected profile instead of the process launch home.
  const pasteLarge = useCallback(
    async (text: string) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      if (!g || !sid) {
        setInput(text);
        return;
      }
      try {
        const r: any = await g.call('file.attach', {
          session_id: sid,
          name: `paste-${Date.now()}.txt`,
          data_url: `data:text/plain;base64,${utf8ToBase64(text)}`,
        });
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setInput(typeof r?.ref_text === 'string' && r.ref_text ? r.ref_text : text);
      } catch {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) setInput(text);
      }
    },
    [activeProfile, sessionId, setInput],
  );

  const send = useCallback(
    async (override?: string) => {
      const text = (override ?? input).trim();
      const g = gw.current;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const files = override === undefined ? attachments : [];
      if ((!text && files.length === 0) || !g || !sessionId) return;
      // An edit resend rewinds history to that user row first (cleared below).
      const rewindRowId = editRowRef.current ?? undefined;
      if (editRowRef.current != null) {
        editRowRef.current = null;
        setEditingRowId(null);
      }
      if (generatingRef.current) {
        // Mid-turn: hold it for the next turn instead of dropping it.
        if (text) enqueueQueued(text);
        if (override === undefined) setInput('');
        return;
      }

      // A leading `/command` runs server-side instead of going to the model:
      // prompt.submit does NOT dispatch slash commands (parity with the TUI's
      // slash fallthrough). Attachments keep the normal prompt path.
      if (!files.length && isSlashCommand(text)) {
        if (override === undefined) setInput('');
        // 1) Commands this app owns (a remote /new would mint a session id we
        //    never adopt; /title and /stop map to existing mobile controls).
        const action = slashMobileAction(text);
        if (action === 'new') {
          void newSessionRef.current();
        } else if (action === 'title') {
          const t = parseSlashCommand(text).arg;
          if (t) void renameSessionRef.current(t);
          else setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: 'Usage: /title <name>' }]);
        } else if (action === 'stop') {
          stopRef.current();
        } else {
          // 2) Curated like the desktop registry: terminal/messaging/settings-only
          //    commands get the reason instead of a doomed slash.exec round-trip.
          const blocked = slashBlockedMessage(text);
          // 3) Offered, but a mobile control owns the surface (model chip, drawer).
          const hint = slashMobileHint(text);
          if (blocked) setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: blocked }]);
          else if (hint) setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: hint }]);
          else {
            await runSlash(text);
            if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
          }
        }
        // A queued slash command doesn't start a turn, so drain the next one here.
        drainRef.current();
        return;
      }

      // Bytes go up BEFORE the prompt through the active runtime session, so
      // attachments land in the selected profile's workspace. A failed upload
      // aborts the send and leaves the input + chips in place to retry.
      let sent: { name: string; path: string; image: boolean }[] = [];
      if (files.length) {
        // Uploads take seconds — a second tap mid-flight would send the file and
        // the prompt twice.
        if (uploading.current) return;
        uploading.current = true;
        setToolLine(`uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
        try {
          sent = await uploadAttachments(files, g, sessionId);
        } catch (e) {
          if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
          setToolLine(null);
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Upload failed: ${errMsg(e)}` }]);
          return;
        } finally {
          uploading.current = false;
        }
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setToolLine(null);
      }

      // Only a user-initiated send clears the composer — a queue drain must not
      // wipe a draft the user is typing while the turn finishes.
      if (override === undefined) {
        setInput('');
        setAttachments([]);
      }
      const images = files.filter(isImageAttachment);
      // Images show as thumbnails in the bubble; other files keep their name line.
      const shownText = [...files.filter((f) => !isImageAttachment(f)).map((f) => `📎 ${f.name}`), text]
        .filter(Boolean)
        .join('\n');
      const submitText = [...sent.map((s) => `[attached ${s.image ? 'image' : 'file'}: ${s.path}]`), text]
        .filter(Boolean)
        .join('\n');
      // Editing the first turn rewrites the whole transcript — same server gate
      // as regenerate (confirm_empty_truncate).
      const rewindTarget =
        rewindRowId != null
          ? messagesRef.current.find((m) => m.rowId === rewindRowId && (m.role === 'user' || m.role === 'assistant'))
          : undefined;
      await beginTurn(
        submitText,
        { text: shownText, media: images },
        rewindRowId,
        rewindTarget ? cutsWholeTranscript(messagesRef.current, rewindTarget.id) : false,
      );
    },
    [activeProfile, input, attachments, sessionId, setInput, setAttachments, beginTurn, runSlash, enqueueQueued],
  );
  sendRef.current = send;

  // Release the local "a turn is running" latch without clearing the live
  // assistant bubble id — a late message.complete can still finalize it. Used
  // when an interrupt can't reach the server, so the composer never sticks.
  const releaseLocalTurn = useCallback(() => {
    liveThinkAid.current = null;
    liveTurnTools.current = [];
    generatingRef.current = false;
    setGenerating(false);
    setToolLine(null);
    setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
    queueMicrotask(() => {
      if (!queueParkedRef.current) drainRef.current();
    });
  }, []);
  releaseLocalTurnRef.current = releaseLocalTurn;

  const stop = useCallback(() => {
    // An explicit halt parks the queue until the user queues again / taps Resume.
    queueParkedRef.current = true;
    setQueueParked(true);
    const g = gw.current;
    const sid = sessionId;
    const profile = activeProfile;
    const epoch = profileEpochRef.current;
    // No live socket/session, or the interrupt itself fails → the server will
    // never emit the turn-end event, so clear the latch ourselves.
    if (!g || !sid) {
      releaseLocalTurn();
      return;
    }
    g.interrupt(sid).catch(() => {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch && sessionIdRef.current === sid) {
        releaseLocalTurn();
      }
    });
  }, [activeProfile, sessionId, releaseLocalTurn]);

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
        releaseLocalTurn();
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
