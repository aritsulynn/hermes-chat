// Profile-ops slice — switchProfile (workspace move + reset) and branchSession.
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { router } from 'expo-router';
import type { GatewayWs, HistoryMessage } from '../../services/gateway-ws';
import type { ModelProviderOption } from '../../services/dashboard';
import { connectionScope, getModel, saveActiveProfile, saveLastSession } from '../../services/connection';
import { CHAT_HISTORY_PAGE, CHAT_WINDOW_TRIM_KEEP } from '../../services/constants';
import { clearSessionMessagesCache } from '../../services/dashboard';
import { clearMediaCaches } from '../../services/media-cache';
import { nid, errMsg } from '../../utils/messages';
import type { Attachment, QueuedPrompt, SubagentRow, TodoItem, UiMessage } from '../../utils/messages';
import type { AskInboxEntry, AskOwner } from '../../services/ask-inbox';
import { historyToItems, mergeUsageState, normalizeProfileName, profileSessionKey } from '../helpers';
import type { AgentProfile, ScopedSessionSummary, SessionInfo, UsageInfo } from '../types';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface ProfileOpsSliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  host: string;
  username: string;
  sessionId: string | null;
  inputRaw: string;
  profiles: AgentProfile[];
  refreshProfiles: () => Promise<void>;
  refreshSessions: (limit?: number) => Promise<ScopedSessionSummary[]>;
  parkLiveTurn: () => void;
  clearStreaming: () => void;
  hydrateSessionContext: (g: GatewayWs, sid: string) => void;
  bindAskOwner: (runtimeSessionId: string, owner: AskOwner) => void;
  draftsRef: MutableRefObject<Map<string, string>>;
  draftKeyRef: MutableRefObject<string>;
  queuedRef: MutableRefObject<QueuedPrompt[]>;
  queueParkedRef: MutableRefObject<boolean>;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  liveTools: MutableRefObject<Map<string, string>>;
  liveToolAid: MutableRefObject<string | null>;
  liveTurnTools: MutableRefObject<string[]>;
  liveTurnDiffs: MutableRefObject<string[]>;
  sessionsLoadingMoreRef: MutableRefObject<boolean>;
  providersRef: MutableRefObject<ModelProviderOption[] | null>;
  providersLoadingRef: MutableRefObject<boolean>;
  providersAtRef: MutableRefObject<number>;
  catalogAtRef: MutableRefObject<number>;
  sessionsFetchRef: MutableRefObject<Promise<ScopedSessionSummary[]> | null>;
  sessionsFetchProfileRef: MutableRefObject<string | null>;
  setError: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setActiveProfile: Dispatch<SetStateAction<string>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionKey: Dispatch<SetStateAction<string | null>>;
  setSessionTitle: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setToolLine: Dispatch<SetStateAction<string | null>>;
  setQueued: Dispatch<SetStateAction<QueuedPrompt[]>>;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  setSubagents: Dispatch<SetStateAction<SubagentRow[]>>;
  setAsk: Dispatch<SetStateAction<any>>;
  setEditingRowId: Dispatch<SetStateAction<number | null>>;
  setInfoOpen: Dispatch<SetStateAction<boolean>>;
  setInputRaw: (value: string) => void;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  setUsageInfo: Dispatch<SetStateAction<UsageInfo | null>>;
  setUsageLoading: Dispatch<SetStateAction<boolean>>;
  setOpeningId: Dispatch<SetStateAction<string | null>>;
  setSessions: Dispatch<SetStateAction<ScopedSessionSummary[]>>;
  setSessionsLimit: Dispatch<SetStateAction<number>>;
  setSessionsHasMore: Dispatch<SetStateAction<boolean>>;
  setSessionsLoadingMore: Dispatch<SetStateAction<boolean>>;
  setProviders: Dispatch<SetStateAction<ModelProviderOption[] | null>>;
  setProvidersLoading: Dispatch<SetStateAction<boolean>>;
  setProvidersError: Dispatch<SetStateAction<string | null>>;
  setModel: Dispatch<SetStateAction<string>>;
  setModelProvider: Dispatch<SetStateAction<string>>;
  /** Record the loaded tail window after branch (limit + exhausted flag). */
  noteHistoryWindow: (limit: number, exhausted: boolean) => void;
  /** Clear the window when leaving the session. */
  resetHistoryWindow: () => void;
}

export interface ProfileOpsSlice {
  switchProfile: (profileName: string) => Promise<void>;
  branchSession: () => Promise<void>;
}

export function useProfileOpsSlice(deps: ProfileOpsSliceDeps): ProfileOpsSlice {
  const {
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
    noteHistoryWindow,
    resetHistoryWindow,
  } = deps;
  const {
    gw,
    activeProfileRef,
    activeProfilePreferenceRef,
    profileEpochRef,
    connectionEpochRef,
    sessionIdRef,
    runtimeOwners,
    generatingRef,
    contextHydrateCancelRef,
    contextPendingSidRef,
    editingRowRef: editRowRef,
    newSessionRef,
  } = runtime;

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
      resetHistoryWindow();
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
    [inputRaw, parkLiveTurn, clearStreaming, profiles, refreshProfiles, refreshSessions, host, username, resetHistoryWindow],
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
      // Windowed like openSession: a branch of a 10k-message transcript opens
      // on the tail page instead of loading everything into JS memory.
      const fullBranch = historyToItems(hist);
      const branchItems =
        fullBranch.length > CHAT_WINDOW_TRIM_KEEP ? fullBranch.slice(-CHAT_WINDOW_TRIM_KEEP) : fullBranch;
      setMessages(branchItems);
      noteHistoryWindow(CHAT_HISTORY_PAGE, fullBranch.length <= branchItems.length);
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
            setUsageInfo((prev) => mergeUsageState(prev, info));
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
  }, [sessionId, hydrateSessionContext, noteHistoryWindow]);

  return { switchProfile, branchSession };
}
