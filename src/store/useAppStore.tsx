// App store orchestrator.
//
// Composes the leaf slices (store/slices/*) and owns the cross-cutting
// orchestration that ties them together: connection/auth, session management,
// the turn engine, and the gateway WS wiring (openWs). The leaf slices hold the
// per-domain state/refs; this file wires them and exposes the `AppStore` context
// consumed via `useApp()` (re-exported from hooks/app-store.tsx).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import {
  checkMe,
  getSessionMessages,
  lastSessionMessagesRawCount,
  opsGet as dashboardOpsGet,
  opsMut as dashboardOpsMut,
  passwordLogin,
} from '../services/dashboard';
import {
  clearCookie,
  clearPassword,
  connectionScope,
  getActiveProfile,
  getCookie as getStoredCookie,
  getModel,
  getPassword,
  getAccent,
  getTheme,
  loadConnection,
  saveCookie,
} from '../services/connection';
import { DEFAULT_PROFILE } from '../services/constants';
import {
  CHAT_HISTORY_MAX_ROWS,
  CHAT_HISTORY_PAGE,
  CHAT_WINDOW_SOFT_CAP,
  CHAT_WINDOW_TRIM_KEEP,
} from '../services/constants';
import { pendingAsks } from '../services/ask-inbox';
import { GatewayWs } from '../services/gateway-ws';
import type { ConnState } from '../services/gateway-ws';
import { errMsg, nid, sliceOlderThan } from '../utils/messages';
import type { UiMessage } from '../utils/messages';
import {
  discoverAgentProfiles,
  historyToItems,
  mergeUsageState,
  normalizeProfileName,
  profileSessionKey,
  scheduleContextHydration,
  withTimeout,
} from './helpers';
import type { AgentProfile, AppStore } from './types';
import type { StoreCtx } from './ctx';
import type { StreamingStore } from './streaming';
import { useThemeSlice } from './slices/useTheme';
import type { ThemeSlice } from './slices/useTheme';
import { useNotificationsSlice } from './slices/useNotifications';
import { useQueueSlice } from './slices/useQueue';
import { useModelsSlice } from './slices/useModels';
import { useSessionInfoSlice } from './slices/useSessionInfo';
import { useLiveRosterSlice } from './slices/useLiveRoster';
import { useLiveSessionsSlice } from './slices/useLiveSessions';
import { useComposerSlice } from './slices/useComposer';
import { useSessionsSlice } from './slices/useSessions';
import { useAskInboxSlice } from './slices/useAskInbox';
import { useAskRepliesSlice } from './slices/useAskReplies';
import { useToolRefreshSlice } from './slices/useToolRefresh';
import { useJumpSlice } from './useJump';
import type { JumpCtx } from './useJump';
import { useLiveTurnSlice } from './slices/useLiveTurn';
import { useCommandsSlice } from './slices/useCommands';
import { useStoreRuntime } from './runtime';
import { useGatewaySlice } from './slices/useGateway';
import { useConnectionSlice } from './slices/useConnection';
import { useSessionOpsSlice } from './slices/useSessionOps';
import { useProfileOpsSlice } from './slices/useProfileOps';
import { useTurnSlice } from './slices/useTurn';
import { useSessionMiscSlice } from './slices/useSessionMisc';

const AppContext = createContext<AppStore | null>(null);

// High-frequency streaming deltas, isolated from AppContext: a token used to
// produce a new object identity, and a single shared context re-rendered every
// useApp() consumer app-wide ~30x/s during streaming (drawer, header, composer,
// all screens). Isolating it helped the rest of the app, but every transcript
// row still subscribed to the whole record, so a token still re-rendered all of
// them — which is what forced the WebSocket client to coalesce deltas into 50ms
// windows, and that coalescing is what capped the visible text at 20 updates a
// second.
//
// So the value here is the store itself, not a snapshot: its identity never
// changes, and a delta wakes exactly one subscriber. See store/streaming.ts.
const StreamingContext = createContext<StreamingStore | null>(null);

function useStreamingStore(): StreamingStore {
  const store = useContext(StreamingContext);
  if (!store) throw new Error('the streaming store must be used inside AppProvider');
  return store;
}

/** Streamed text for one message. Re-renders only this message's subscriber. */
export function useStreamingText(id: string): string {
  const store = useStreamingStore();
  const subscribe = useCallback((cb: () => void) => store.subscribe(id, cb), [store, id]);
  const read = useCallback(() => store.read(id), [store, id]);
  return useSyncExternalStore(subscribe, read, read);
}

/** A one-off read of one message's streamed text, without following it. */
export function useStreamingRead(): (id: string) => string {
  const store = useStreamingStore();
  return useCallback((id: string) => store.read(id), [store]);
}

// The theme triple, isolated from AppContext for the same reason as streaming.
// A theme toggle changes `theme`, so leaving it in the shared value gave every
// useApp() consumer a new context object and re-rendered all of them — the
// three themed hosts in AppShell.tsx, the drawer's already-mounted screens,
// the file-preview host — for a colour change. Only 18 sites read the theme, so
// it gets its own context and the rest of the app never hears about it.
const ThemeContext = createContext<ThemeSlice | null>(null);

export function useThemeValue(): ThemeSlice {
  const v = useContext(ThemeContext);
  if (!v) throw new Error('useThemeValue must be used inside AppProvider');
  return v;
}

// `conn` is isolated from AppContext for the same reason. It flips on every
// socket transition — and on Android that is exactly what happens when the user
// leaves to another app: the WebView's socket dies with 1003 and `conn` runs
// ready → reconnecting → ready. In the shared value that gave all 27 useApp()
// consumers a new object, so the chat screen and its virtualized transcript
// re-rendered twice over on every app resume — which read to the user as "the
// app reloaded". Only four components read `conn` at all.
const ConnContext = createContext<ConnState>('idle');

export function useConn(): ConnState {
  return useContext(ConnContext);
}

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
  useEffect(() => {
    const nextScope = connectionScope(host, username);
    if (passwordScopeRef.current && passwordScopeRef.current !== nextScope) {
      passwordScopeRef.current = '';
      setPasswordState('');
    }
  }, [host, username]);
  const [booting, setBooting] = useState(true);
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
  // True once the tail paging has hit CHAT_HISTORY_MAX_ROWS with rows still on
  // the server. State, not just a ref, because the chat header has to re-render
  // and swap its "load older" affordance for the jump sheet.
  const [historyCapped, setHistoryCapped] = useState(false);
  // Transcript window (10k+ sessions): only a tail page lives in `messages`;
  // older rows are paged in on demand and the head auto-trims past the cap.
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyExhausted, setHistoryExhausted] = useState(true);
  const [trimmedOlder, setTrimmedOlder] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [toolLine, setToolLine] = useState<string | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);
  // Local notifications (turn complete / server asks while backgrounded).
  const notificationsSlice = useNotificationsSlice();
  const { notifyEnabled, setNotifications, loadNotifications } = notificationsSlice;

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

    runtimeOwners,

    generatingRef,

    messagesRef,
    historyLimitRef,
    historyLoadingRef,
    historyExhaustedRef,
    historyCappedRef,
    profilesRef,
    sessionIdRef,

    contextHydrateCancelRef,
    contextPendingSidRef,
    stampRowIdsRef,
    resyncRef,
    connectRef,

    stopRef,

    releaseLocalTurnRef,
  } = runtime;
  activeProfileRef.current = activeProfile;
  profilesRef.current = profiles;

  // Latest host/profile/sessionKey for callbacks frozen in openWs (created once).
  const latest = useRef({ host, username, activeProfile, sessionKey });
  latest.current = { host, username, activeProfile, sessionKey };

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
    } catch (e) {
      console.warn('[store] profile refresh failed', e);
    }
  }, [acceptRotatedCookie, host, username]);

  // ── Transcript windowing ──────────────────────────────────────────────
  // Steady state keeps ~1 page of bubbles in `messages`; older rows page in
  // via a growing tail limit (REST has no cursor) and the head auto-trims
  // past the soft cap. Trimmed/paged-out rows stay server-side and come back
  // through loadOlderMessages — nothing durable is lost.
  const noteHistoryWindow = useCallback((limit: number, exhausted: boolean) => {
    historyLimitRef.current = limit;
    historyExhaustedRef.current = exhausted;
    setHistoryExhausted(exhausted);
  }, []);
  const resetHistoryWindow = useCallback(() => {
    historyLimitRef.current = 0;
    historyLoadingRef.current = false;
    historyExhaustedRef.current = true;
    // A new session has not hit the cap yet; leaving this set would tell the
    // chat header to offer a jump sheet for a conversation of three messages.
    historyCappedRef.current = false;
    setHistoryCapped(false);
    setHistoryLoadingMore(false);
    setHistoryExhausted(true);
    setTrimmedOlder(0);
  }, []);

  // The accumulating slice context — see store/ctx.ts. One object, handed to
  // every slice in dependency order and grown with each slice's return, so no
  // slice declares a deps interface and no call site lists props. The values
  // are the same objects the old props carried, so every useCallback dep array
  // downstream is unaffected. `hydrateSessionContext` is added below, once
  // useSessionInfoSlice has published setUsageInfo.
  const themeSlice = useThemeSlice();
  const ctx = {
    ...runtime,
    ...themeSlice,
    ...notificationsSlice,
    host,
    setHost,
    username,
    setUsername,
    password,
    setPassword,
    passwordScopeRef,
    booting,
    setBooting,
    busy,
    setBusy,
    error,
    setError,
    conn,
    setConn,
    activeProfile,
    setActiveProfile,
    profiles,
    setProfiles,
    authed,
    setAuthed,
    openingId,
    setOpeningId,
    sessionId,
    setSessionId,
    sessionKey,
    setSessionKey,
    sessionTitle,
    setSessionTitle,
    messages,
    setMessages,
    historyLoadingMore,
    setHistoryLoadingMore,
    historyExhausted,
    setHistoryExhausted,
    trimmedOlder,
    setTrimmedOlder,
    generating,
    setGenerating,
    toolLine,
    setToolLine,
    editingRowId,
    setEditingRowId,
    latest,
    acceptRotatedCookie,
    refreshProfiles,
    noteHistoryWindow,
    resetHistoryWindow,
  } as unknown as StoreCtx;
  // Hand a slice the shared context and publish whatever it returns back into
  // it, so the next slice in dependency order can read it. One line per slice.
  const add = <T extends object>(slice: T): T => Object.assign(ctx, slice);

  const { hydrateTheme } = themeSlice;
  const { todos, subagents } = add(useLiveRosterSlice(ctx));
  const { liveSessions, liveSessionsKnown, refreshLiveSessions } = add(useLiveSessionsSlice(ctx));
  const { loadCommandsCatalog } = add(useCommandsSlice(ctx));
  const {
    sessions,

    sessionsHasMore,

    sessionsLoadingMore,

    refreshSessions,
    loadMoreSessions,
  } = add(useSessionsSlice(ctx));
  // Live runtime session id for callbacks frozen in openWs (reconnect replay).
  sessionIdRef.current = sessionId;
  const { sessionInfo, usageInfo, setUsageInfo } = add(useSessionInfoSlice(ctx));
  const {
    queued,
    queueParked,

    enqueueQueued,
    removeQueued,
    clearQueue,
    resumeQueue,
    sendQueuedNow,
  } = add(useQueueSlice(ctx));
  generatingRef.current = generating;
  messagesRef.current = messages;
  const {
    streaming,

    parkedLiveRef,
    lastTurnEventAt,
    clearStreaming,

    reanchorLiveTurn,
  } = add(useLiveTurnSlice(ctx));

  const {
    model,
    modelProvider,
    effort,
    providers,
    providersLoading,
    providersError,
    setModel,
    setModelProvider,

    loadProviders,
    loadReasoningDisplay,
    pickModel,
    applyEffort,
    applyFast,
    applyApprovalMode,
    applyShowReasoning,
    showReasoning,
  } = add(useModelsSlice(ctx));
  const {
    ask,

    askInbox,
  } = add(useAskInboxSlice(ctx));

  const { refreshToolResults } = add(useToolRefreshSlice(ctx));

  // Drop the head past the soft cap. Never the live tail, never while a turn
  // runs, and the screen only calls this while pinned at the bottom — reading
  // history up top is never yanked.
  const trimHead = useCallback(() => {
    const cur = messagesRef.current;
    if (cur.length <= CHAT_WINDOW_SOFT_CAP || generatingRef.current) return;
    // Never inside a jumped window: those rows were fetched at an anchor, not
    // paged from the tail, so trimming one would silently rewrite history the
    // user navigated to and the head trim has nothing to page back from.
    if (!jump.atTail) return;
    const drop = cur.length - CHAT_WINDOW_TRIM_KEEP;
    if (drop <= 0) return;
    const next = cur.slice(drop);
    messagesRef.current = next;
    setMessages(next);
    setTrimmedOlder((c) => c + drop);
    // Trimmed rows are refetchable, so the window is no longer exhaustive.
    historyExhaustedRef.current = false;
    setHistoryExhausted(false);
  }, []);
  // Fetch the next older page and prepend just the older slice (anchor = the
  // window's oldest durable row). Returns true when a fetch ran (even with an
  // empty head) so the screen can hold the scroll position; false when skipped.
  const loadOlderMessages = useCallback(async (): Promise<boolean> => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const targetUser = latest.current.username;
    const cur = messagesRef.current;
    if (!h || !sk || cur.length === 0) return false;
    // Inside a jumped window the tail's growing-limit paging is meaningless — it
    // would fetch a window the user did not ask for and splice it onto an
    // unrelated one. Jump sheet handles navigation here; see useJump.
    if (!jump.atTail) return false;
    // Cap check BEFORE the exhausted guard, and that ordering is the whole point.
    // Both mean "the tail fetch cannot page further", and on a long session both
    // are true at once — the window sits at the cap AND the server has more rows.
    // With the exhausted guard first, `return false` fired before the cap was
    // ever evaluated, so the flag that tells the UI to offer the jump sheet was
    // unreachable in precisely the case it exists for.
    const nextLimit = Math.min(historyLimitRef.current + CHAT_HISTORY_PAGE, CHAT_HISTORY_MAX_ROWS);
    if (nextLimit <= historyLimitRef.current) {
      historyExhaustedRef.current = true;
      setHistoryExhausted(true);
      historyCappedRef.current = true;
      setHistoryCapped(true);
      return false;
    }
    if (historyLoadingRef.current || historyExhaustedRef.current || generatingRef.current) return false;
    historyLoadingRef.current = true;
    setHistoryLoadingMore(true);
    try {
      const items = await getSessionMessages(
        h,
        cookie.current,
        sk,
        profile,
        nextLimit,
        connectionScope(h, targetUser),
        async (nextCookie) => acceptRotatedCookie(nextCookie, h, targetUser, connectionEpoch, epoch),
      );
      if (
        activeProfileRef.current !== profile ||
        profileEpochRef.current !== epoch ||
        connectionEpochRef.current !== connectionEpoch ||
        latest.current.sessionKey !== sk
      )
        return true;
      historyLimitRef.current = nextLimit;
      const head = sliceOlderThan(historyToItems(items), messagesRef.current);
      if (head.length > 0) {
        setMessages((prev) => [...head, ...prev]);
        setTrimmedOlder((c) => Math.max(0, c - head.length));
        // Older rows existed beyond the anchor — the window is not exhaustive.
        historyExhaustedRef.current = false;
        setHistoryExhausted(false);
      } else if (lastSessionMessagesRawCount() < nextLimit) {
        historyExhaustedRef.current = true;
        setHistoryExhausted(true);
      }
      return true;
    } catch {
      return true;
    } finally {
      historyLoadingRef.current = false;
      setHistoryLoadingMore(false);
    }
  }, [acceptRotatedCookie]);
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
          CHAT_HISTORY_PAGE,
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
      } catch (e) {
        console.warn('[store] stampRowIds failed', e);
      }
    })();
  };
  // Post-reconnect resync: the replay ring had already dropped the gap, so the
  // transcript must be rebuilt from REST rather than trusted piecemeal.
  resyncRef.current = () => {
    // Rebuild the loaded window (not a fixed 200): paging/trim state stays
    // intact across a reconnect instead of collapsing back to a full load.
    void refreshTail().catch((e) => console.warn('[store] resync failed', e));
  };

  // Rebuild the tail window from REST. Shared by the reconnect resync and by
  // jumping back from a prompt window, which is why it is a named helper rather
  // than inline in either place.
  const refreshTail = useCallback(async () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const targetUser = latest.current.username;
    const runtime = sessionIdRef.current;
    if (!h || !sk || !runtime) return;
    const hist = await getSessionMessages(
      h,
      cookie.current,
      sk,
      profile,
      historyLimitRef.current > 0 ? historyLimitRef.current : CHAT_HISTORY_PAGE,
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
  }, [acceptRotatedCookie]);

  // Jump-to-prompt. Composed here, after refreshTail, because the slice needs it
  // to restore the tail window when the user leaves a jumped one. Everything else
  // comes off the accumulating ctx, which already carries host / profile /
  // sessionKey / the cookie ref and the two scope epochs.
  const jump = add(useJumpSlice({ ...(ctx as unknown as JumpCtx), refreshTail }));

  const hydrateSessionContext = useCallback((g: GatewayWs, sid: string) => {
    contextHydrateCancelRef.current?.();
    contextPendingSidRef.current = sid;
    contextHydrateCancelRef.current = scheduleContextHydration(
      g,
      sid,
      () => sessionIdRef.current === sid,
      (snapshot) => {
        if (contextPendingSidRef.current === sid) contextPendingSidRef.current = null;
        setUsageInfo((prev) => mergeUsageState(prev, snapshot));
      },
    );
  }, []);
  // Closes the loop on the one helper that needed a slice's output to exist
  // (setUsageInfo). Every slice that reads it is called below this line.
  ctx.hydrateSessionContext = hydrateSessionContext;

  const {
    input,

    setInput,

    attachments,
    setAttachments,
    copiedId,
    copyText,
  } = add(useComposerSlice(ctx));
  const {
    respondToInbox,

    answerInboxApproval,
    openAskEntry,
    answerAsk,
    answerValue,
    answerApproval,
    dismissAsk,
  } = add(useAskRepliesSlice(ctx));
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await loadConnection();
        // Assert, not migrate: nothing on this platform writes a password, so
        // this can only ever be clearing a value left by an older build. It is
        // kept because "no secret is ever read back out of localStorage" is a
        // property worth enforcing on every boot rather than a one-time fix.
        await clearPassword(c.host, c.username);
        if (cancelled) return;
        setHost(c.host);
        setUsername(c.username);
        // Prefill: always empty on web — the browser's cookie jar is the
        // session, and there is no stored password to restore.
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
        const savedAccent = await getAccent().catch(() => null);
        if (cancelled) return;
        hydrateTheme(savedTheme, savedAccent);
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
  // Second late helper: only useConnectionSlice reads it, and it is called
  // below. Same one-line publish as hydrateSessionContext.
  ctx.ensureCookie = ensureCookie;

  const { probeWorkingSessions, reconnectNow } = add(useGatewaySlice(ctx));

  const { connect, login, logout } = add(useConnectionSlice(ctx));
  connectRef.current = connect;

  // ── Sessions ─────────────────────────────────────────────────────────────

  const { openSession, newSession, exportSession } = add(useSessionOpsSlice(ctx));

  const { switchProfile, branchSession } = add(useProfileOpsSlice(ctx));

  // ── Chat ─────────────────────────────────────────────────────────────────
  // Scrolling lives in the chat screen (it owns the FlatList ref); send()
  // only queues state — the screen scrolls after calling it.

  // useCallback so Composer's memo() holds between streamed tokens (the deps
  // only move when the user actually types, attaches or a turn starts/ends).

  const { editMessage, cancelEdit, regenerate, pasteLarge, send, releaseLocalTurn, stop } = add(useTurnSlice(ctx));

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

  const { renameSession, deleteSessionById, redirectLive, setGlobalModel } = add(useSessionMiscSlice(ctx));

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
      historyLoadingMore,
      historyExhausted,
      trimmedOlder,
      loadOlderMessages,
      trimHead,
      // Jump-to-prompt: the prompt index, the jumped-window state, and the
      // transitions. `atTail` matters beyond the sheet — the head-trim and the
      // composer both have to know the window is not the session tail.
      index: jump.index,
      indexLoading: jump.indexLoading,
      indexError: jump.indexError,
      indexExhausted: jump.indexExhausted,
      loadIndex: jump.loadIndex,
      historyCapped,
      atTail: jump.atTail,
      jumpAt: jump.jumpAt,
      jumping: jump.jumping,
      jumpError: jump.jumpError,
      jumpTo: jump.jumpTo,
      jumpOlder: jump.jumpOlder,
      jumpNewer: jump.jumpNewer,
      canJumpOlder: jump.canJumpOlder,
      canJumpNewer: jump.canJumpNewer,
      backToTail: jump.backToTail,
      clearJump: jump.clearJump,
      input,
      setInput,
      model,
      modelProvider,
      effort,
      applyEffort,
      applyFast,
      showReasoning,
      loadReasoningDisplay,
      applyShowReasoning,
      providers,
      providersLoading,
      providersError,
      attachments,
      setAttachments,
      generating,
      copiedId,
      sessionInfo,
      usageInfo,
      toolLine,
      ask,
      askInbox,
      pendingAskCount: pendingAsks(askInbox).length,
      openAskEntry,
      respondToInbox,
      answerInboxApproval,
      connect,
      login,
      logout,
      reconnectNow,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      sessionsLoadingMore,
      openSession,
      newSession,
      exportSession,
      send,
      stop,
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
      liveSessions,
      liveSessionsKnown,
      refreshLiveSessions,
      refreshToolResults,
      pickModel,
      copyText,
      answerValue,
      answerApproval,
      answerAsk,
      dismissAsk,
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
    [
      booting,
      authed,
      busy,
      error,
      host,
      setPassword,
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
      historyLoadingMore,
      historyExhausted,
      trimmedOlder,
      loadOlderMessages,
      trimHead,
      // Jump slice state and its stable transitions. The callbacks read refs
      // internally, so they are identity-stable and listed once.
      jump.index,
      jump.indexLoading,
      jump.indexError,
      jump.indexExhausted,
      jump.loadIndex,
      historyCapped,
      jump.atTail,
      jump.jumpAt,
      jump.jumping,
      jump.jumpError,
      jump.jumpTo,
      jump.jumpOlder,
      jump.jumpNewer,
      jump.canJumpOlder,
      jump.canJumpNewer,
      jump.backToTail,
      jump.clearJump,
      input,
      setInput,
      model,
      modelProvider,
      effort,
      applyEffort,
      applyFast,
      showReasoning,
      loadReasoningDisplay,
      applyShowReasoning,
      providers,
      providersLoading,
      providersError,
      attachments,
      generating,
      copiedId,
      sessionInfo,
      usageInfo,
      toolLine,
      ask,
      askInbox,
      openAskEntry,
      respondToInbox,
      answerInboxApproval,
      connect,
      login,
      logout,
      reconnectNow,
      refreshSessions,
      loadMoreSessions,
      sessionsHasMore,
      sessionsLoadingMore,
      openSession,
      newSession,
      exportSession,
      send,
      stop,
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
      liveSessions,
      liveSessionsKnown,
      refreshLiveSessions,
      refreshToolResults,
      pickModel,
      copyText,
      answerValue,
      answerApproval,
      answerAsk,
      dismissAsk,
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

  return (
    <ConnContext.Provider value={conn}>
      <AppContext.Provider value={value}>
        <ThemeContext.Provider value={themeSlice}>
          <StreamingContext.Provider value={streaming}>{children}</StreamingContext.Provider>
        </ThemeContext.Provider>
      </AppContext.Provider>
    </ConnContext.Provider>
  );
}
