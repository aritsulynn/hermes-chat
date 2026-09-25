// Connection slice — the connect pipeline: connect / login / logout.
// Extracted from store/useAppStore.tsx.
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import type { GatewayWs } from '../../lib/gateway-ws';
import type { ConnState, ServerAsk, SessionSummary } from '../../lib/gateway-ws';
import { clearSessionMessagesCache, logoutDashboard, probeStatus } from '../../lib/dashboard';
import type { ModelProviderOption } from '../../lib/dashboard';
import {
  connectionScope,
  forgetAll,
  getLastSession,
  getModel,
  getPassword,
  saveActiveProfile,
  saveHost,
  savePassword,
} from '../../lib/connection';
import { clearMediaCaches } from '../../lib/media-cache';
import { DEFAULT_PROFILE } from '../../lib/constants';
import type { AskInboxEntry } from '../../lib/ask-inbox';
import type { HermesNotificationResponse } from '../../lib/notifications';
import { errMsg } from '../../utils/messages';
import type { Attachment, QueuedPrompt, SubagentRow, TodoItem, UiMessage } from '../../utils/messages';
import { discoverAgentProfiles, withTimeout } from '../helpers';
import type { AgentProfile, ScopedSessionSummary } from '../types';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface ConnectionSliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  providersRef: MutableRefObject<ModelProviderOption[] | null>;
  acceptRotatedCookie: (
    nextCookie: string,
    host: string,
    username: string,
    connectionEpoch: number,
    profileEpoch: number,
  ) => Promise<void>;
  ensureCookie: (h: string, user: string, pw: string, isCurrent?: () => boolean) => Promise<string>;
  openWs: (h: string, user: string) => Promise<GatewayWs>;
  refreshSessions: (limit?: number) => Promise<ScopedSessionSummary[]>;
  rememberPw: boolean;
  passwordScopeRef: MutableRefObject<string>;
  host: string;
  username: string;
  password: string;
  dismissAskNotifications: (entries?: AskInboxEntry[]) => void;
  setAskInbox: Dispatch<SetStateAction<AskInboxEntry[]>>;
  setAsk: Dispatch<SetStateAction<ServerAsk | null>>;
  askRef: MutableRefObject<ServerAsk | null>;
  askInboxRef: MutableRefObject<AskInboxEntry[]>;
  handledNotificationResponsesRef: MutableRefObject<Set<string>>;
  pendingNotificationResponsesRef: MutableRefObject<HermesNotificationResponse[]>;
  askHydrationRef: MutableRefObject<number>;
  notificationActionInFlightRef: MutableRefObject<boolean>;
  turnOwnerRef: MutableRefObject<Map<string, string>>;
  parkedLiveRef: MutableRefObject<Set<string>>;
  draftsRef: MutableRefObject<Map<string, string>>;
  queuedRef: MutableRefObject<QueuedPrompt[]>;
  queueParkedRef: MutableRefObject<boolean>;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  clearStreaming: () => void;
  sessionsFetchRef: MutableRefObject<Promise<ScopedSessionSummary[]> | null>;
  sessionsFetchProfileRef: MutableRefObject<string | null>;
  setInputRaw: (value: string) => void;
  setPassword: (value: string) => void;
  setQueued: Dispatch<SetStateAction<QueuedPrompt[]>>;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  setProviders: Dispatch<SetStateAction<ModelProviderOption[] | null>>;
  setProfiles: Dispatch<SetStateAction<AgentProfile[]>>;
  setActiveProfile: Dispatch<SetStateAction<string>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setModel: Dispatch<SetStateAction<string>>;
  setModelProvider: Dispatch<SetStateAction<string>>;
  setAuthed: Dispatch<SetStateAction<boolean>>;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionKey: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setSessions: Dispatch<SetStateAction<ScopedSessionSummary[]>>;
  setSessionInfo: Dispatch<SetStateAction<any>>;
  setUsageInfo: Dispatch<SetStateAction<any>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setToolLine: Dispatch<SetStateAction<string | null>>;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  setSubagents: Dispatch<SetStateAction<SubagentRow[]>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setEditingRowId: Dispatch<SetStateAction<number | null>>;
  setInfoOpen: Dispatch<SetStateAction<boolean>>;
}

export interface ConnectionSlice {
  connect: (h: string, user: string, pw: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useConnectionSlice(deps: ConnectionSliceDeps): ConnectionSlice {
  const {
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
  } = deps;
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
    runtimeOwners,
    runtimeAskOwners,
    generatingRef,
    sessionIdRef,
    editingRowRef: editRowRef,
    openSessionRef,
  } = runtime;

  const connect = useCallback(
    async (h: string, user: string, pw: string) => {
      const requestId = ++connectRequestRef.current;
      await logoutCleanupRef.current.catch(() => {});
      if (requestId !== connectRequestRef.current) return;
      const nextHost = h.trim();
      const nextUser = user.trim();
      const nextScope = connectionScope(nextHost, nextUser);
      const connectionEpoch = ++connectionEpochRef.current;
      let profileEpoch = profileEpochRef.current;
      const isCurrent = () =>
        connectionEpochRef.current === connectionEpoch && profileEpochRef.current === profileEpoch;
      const previousScope = latest.current.host ? connectionScope(latest.current.host, latest.current.username) : '';
      // Boot/login can enter connect before the next render commits host/user;
      // keep frozen WS callbacks scoped to this attempt immediately.
      latest.current = { ...latest.current, host: nextHost, username: nextUser };

      if (cookieScope.current !== nextScope) {
        cookie.current = '';
        cookieScope.current = '';
      }
      if (previousScope && previousScope !== nextScope) {
        profileEpoch = ++profileEpochRef.current;
        clearMediaCaches();
        clearSessionMessagesCache();
        dismissAskNotifications();
        handledNotificationResponsesRef.current.clear();
        pendingNotificationResponsesRef.current = [];
        askHydrationRef.current = 0;
        notificationActionInFlightRef.current = false;
        askInboxRef.current = [];
        setAskInbox([]);
        setAsk(null);
        runtimeOwners.current.clear();
        runtimeAskOwners.current.clear();
        turnOwnerRef.current.clear();
        parkedLiveRef.current.clear();
        draftsRef.current.clear();
        setInputRaw('');
        setPassword('');
        queuedRef.current = [];
        setQueued([]);
        queueParkedRef.current = false;
        setQueueParked(false);
        setProviders(null);
        providersRef.current = null;
        setProfiles([]);
        activeProfilePreferenceRef.current = null;
        activeProfileRef.current = DEFAULT_PROFILE;
        setActiveProfile(DEFAULT_PROFILE);
      }
      setBusy(true);
      setError(null);
      try {
        const probe = await probeStatus(nextHost);
        if (!isCurrent()) throw new Error('Connection superseded');
        if (!probe.authRequired) {
          throw new Error('Dashboard has no auth gate (loopback?) — this app needs a gated dashboard with basic auth.');
        }
        if (!probe.providers.includes('basic')) {
          throw new Error(`Dashboard auth providers [${probe.providers.join(',')}] — basic not offered.`);
        }
        await ensureCookie(nextHost, nextUser, pw, isCurrent);
        if (!isCurrent()) throw new Error('Connection superseded');
        const discovered = await discoverAgentProfiles(nextHost, cookie.current, async (nextCookie) => {
          if (!isCurrent()) return;
          await acceptRotatedCookie(nextCookie, nextHost, nextUser, connectionEpoch, profileEpoch);
        });
        if (!isCurrent()) throw new Error('Connection superseded');
        setProfiles(discovered.profiles);
        const preferred = activeProfilePreferenceRef.current;
        const selected =
          preferred && discovered.profiles.some((profile) => profile.name === preferred)
            ? preferred
            : discovered.current;
        activeProfilePreferenceRef.current = selected;
        activeProfileRef.current = selected;
        setActiveProfile(selected);
        void saveActiveProfile(selected, nextScope);
        const selectedInfo = discovered.profiles.find((profile) => profile.name === selected);
        const rememberedModel = await getModel(selected, nextScope).catch(() => null);
        if (!isCurrent()) throw new Error('Connection superseded');
        setModel(String(rememberedModel?.model ?? selectedInfo?.model ?? ''));
        setModelProvider(String(rememberedModel?.provider ?? selectedInfo?.provider ?? ''));
        gw.current?.close();
        const ws = await openWs(nextHost, nextUser);
        if (!isCurrent()) {
          ws.close();
          throw new Error('Connection superseded');
        }
        gw.current = ws;
        const ok = await ws.connect();
        if (!isCurrent()) {
          ws.close();
          return;
        }
        if (!ok) {
          // Stop the background reconnect loop — the user retries explicitly.
          const d = ws.wsDebug();
          ws.close();
          if (gw.current === ws) gw.current = null;
          const closes = d.closes.map((c) => `${c.code ?? '?'}${c.reason ? `:${c.reason}` : ''}`).join(',') || 'none';
          throw new Error(
            `WS not ready in 15s (opens=${d.opens} errors=${d.errors} closes=[${closes}] lastEvent=${d.lastEvent ?? 'none'}) — REST ok but the socket never became ready. Check the dashboard log for /api/ws rejections.`,
          );
        }
        await saveHost(nextHost, nextUser);
        if (!isCurrent()) return;
        // Never persist the basic-auth password in browser storage. Native keeps
        // the existing opt-in SecureStore behaviour.
        if (rememberPw && pw && Platform.OS !== 'web') {
          await savePassword(pw, nextHost, nextUser);
        }
        // Bounded waits — a wedged dashboard must never trap boot on a
        // spinner: list/open each get a ceiling, then we land on chat.
        let list: SessionSummary[] = [];
        try {
          list = await withTimeout(refreshSessions(), 30000);
        } catch {
          list = [];
        }
        if (!isCurrent()) return;
        setAuthed(true);
        if (list.length > 0) {
          // Restore the chat the user was last viewing, else the most recent.
          let target = list[0];
          try {
            const saved = await getLastSession(activeProfileRef.current, connectionScope(nextHost, nextUser));
            const found = saved ? list.find((s) => s.id === saved) : undefined;
            if (found) target = found;
          } catch {}
          try {
            await withTimeout(openSessionRef.current(target), 25000);
          } catch {
            if (isCurrent()) router.replace('/chat');
          }
          return;
        }
        if (isCurrent()) router.replace('/chat');
      } catch (e) {
        if (isCurrent() && errMsg(e) !== 'Connection superseded') setError(errMsg(e));
      } finally {
        if (isCurrent()) setBusy(false);
      }
    },
    [acceptRotatedCookie, ensureCookie, openWs, rememberPw, refreshSessions],
  );

  const login = useCallback(async () => {
    const scope = connectionScope(host, username);
    const enteredPassword = passwordScopeRef.current === scope ? password : '';
    const pw = enteredPassword || (await getPassword(host, username)) || '';
    if (!host.trim() || !username.trim() || !pw) {
      setError('Fill host, username and password');
      return;
    }
    await connect(host.trim(), username.trim(), pw);
  }, [host, username, password, connect]);

  const logout = useCallback(async () => {
    const logoutHost = host;
    const logoutUser = username;
    const logoutCookie = cookie.current;
    connectionEpochRef.current += 1;
    connectRequestRef.current += 1;
    gw.current?.close();
    gw.current?.clearAskRecords();
    gw.current = null;
    cookie.current = '';
    cookieScope.current = '';
    liveThinkAid.current = null;
    liveAid.current = null;
    generatingRef.current = false;
    draftsRef.current.clear();
    parkedLiveRef.current.clear();
    turnOwnerRef.current.clear();
    runtimeOwners.current.clear();
    runtimeAskOwners.current.clear();
    profileEpochRef.current += 1;
    sessionsFetchRef.current = null;
    sessionsFetchProfileRef.current = null;
    setInputRaw('');
    clearMediaCaches();
    clearSessionMessagesCache();
    setPassword('');
    setAuthed(false);
    setConn('idle');
    setProfiles([]);
    activeProfilePreferenceRef.current = null;
    activeProfileRef.current = DEFAULT_PROFILE;
    setActiveProfile(DEFAULT_PROFILE);
    sessionIdRef.current = null;
    setSessionId(null);
    setSessionKey(null);
    setMessages([]);
    clearStreaming();
    setSessions([]);
    setSessionInfo(null);
    setUsageInfo(null);
    setGenerating(false);
    setAsk(null);
    askRef.current = null;
    dismissAskNotifications();
    handledNotificationResponsesRef.current.clear();
    askInboxRef.current = [];
    setAskInbox([]);
    pendingNotificationResponsesRef.current = [];
    askHydrationRef.current = 0;
    setToolLine(null);
    setTodos([]);
    setSubagents([]);
    setProviders(null);
    queuedRef.current = [];
    setQueued([]);
    queueParkedRef.current = false;
    setQueueParked(false);
    setAttachments([]);
    editRowRef.current = null;
    setEditingRowId(null);
    setInfoOpen(false);
    router.replace('/login');

    const cleanup = (async () => {
      try {
        await logoutDashboard(logoutHost, logoutCookie);
        await forgetAll(logoutHost, logoutUser);
      } catch {}
    })();
    logoutCleanupRef.current = cleanup;
    await cleanup;
  }, [host, username]);

  return { connect, login, logout };
}
