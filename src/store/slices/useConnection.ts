// Connection slice — the connect pipeline: connect / login / logout.
// Extracted from store/useAppStore.tsx.
import { useCallback } from 'react';
import { navigate } from '../nav';
import type { SessionSummary } from '../../services/gateway-ws';
import { clearSessionMessagesCache, logoutDashboard, probeStatus } from '../../services/dashboard';
import {
  connectionScope,
  forgetAll,
  getLastSession,
  getModel,
  getPassword,
  saveActiveProfile,
  saveHost,
} from '../../services/connection';
import { clearMediaCaches } from '../../services/media-cache';
import { clearOutbox, loadOutbox } from '../../services/outbox';
import { DEFAULT_PROFILE } from '../../services/constants';
import { errMsg } from '../../utils/messages';
import { discoverAgentProfiles, withTimeout } from '../helpers';
import type { StoreCtx } from '../ctx';

export interface ConnectionSlice {
  connect: (h: string, user: string, pw: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useConnectionSlice(ctx: StoreCtx): ConnectionSlice {
  const {
    latest,
    providersRef,
    acceptRotatedCookie,
    ensureCookie,
    openWs,
    refreshSessions,

    host,
    username,
    password,
    setAskInbox,
    setAsk,
    askRef,
    askInboxRef,
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
  } = ctx;

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
        askInboxRef.current = [];
        setAskInbox([]);
        setAsk(null);
        runtimeOwners.current.clear();
        runtimeAskOwners.current.clear();
        turnOwnerRef.current.clear();
        parkedLiveRef.current.clear();
        draftsRef.current.clear();
        // P3: the new account brings its own unsent work, if any.
        void loadOutbox(nextScope)
          .then((box) => {
            if (!isCurrent()) return;
            for (const [key, value] of box.drafts) {
              if (!draftsRef.current.has(key)) draftsRef.current.set(key, value);
            }
          })
          .catch(() => {});
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
        // Nothing to persist: the browser already holds the resulting session
        // cookie in its own jar, where JS cannot read it. Storing the password
        // would add a real secret to `localStorage` and buy nothing back.
        //
        // The old `rememberPw` flag is gone, and with it the last
        // writer of `savePassword`; see the "Credentials" note in
        // services/connection.ts for what the boot-time `clearPassword` call is
        // now asserting.
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
            // Restore for its side effects only — do not navigate. See the note
            // in openSession: navigating here is what made every deep link to a
            // non-chat route land on /chat instead.
            await withTimeout(openSessionRef.current(target, { navigate: false }), 25000);
          } catch {
            if (isCurrent()) navigate('/chat', { replace: true });
          }
          return;
        }
        if (isCurrent()) navigate('/chat', { replace: true });
      } catch (e) {
        if (isCurrent() && errMsg(e) !== 'Connection superseded') setError(errMsg(e));
      } finally {
        if (isCurrent()) setBusy(false);
      }
    },
    [acceptRotatedCookie, ensureCookie, openWs, refreshSessions],
  );

  const login = useCallback(async () => {
    // What is typed is what gets sent — see the note at the password state.
    const pw = password || (await getPassword(host, username)) || '';
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
    askInboxRef.current = [];
    setAskInbox([]);
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
    // P3 parity with the in-memory clear above: logging out forgets this
    // account's unsent work instead of restoring it on the next login.
    void clearOutbox(connectionScope(logoutHost, logoutUser));
    navigate('/login', { replace: true });

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
