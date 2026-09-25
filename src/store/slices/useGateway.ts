// Gateway slice — the gateway WS wiring: the active-list probe, reconnect
// reconcile, server-ask hydration, and the long-lived openWs() factory.
// Extracted from store/useAppStore.tsx.
import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { router } from 'expo-router';
import { GatewayWs } from '../../services/gateway-ws';
import type { ConnState, ServerAsk } from '../../services/gateway-ws';
import { clearSessionMessagesCache, mintWsTicket, toWsUrl } from '../../services/dashboard';
import type { ModelProviderOption } from '../../services/dashboard';
import { connectionScope, forgetAll, saveCookie, saveModel } from '../../services/connection';
import { clearMediaCaches } from '../../services/media-cache';
import { DEFAULT_PROFILE } from '../../services/constants';
import { askNotificationCategory, dismissNotification, pushNotification } from '../../services/notifications';
import type { HermesNotificationResponse } from '../../services/notifications';
import { upsertAsk } from '../../services/ask-inbox';
import type { AskInboxEntry, AskInboxInput, AskInboxStatus, AskOwner } from '../../services/ask-inbox';
import { changedFilesFromDiff } from '../../utils/diff';
import { formatToolCommand, formatToolResult } from '../../utils/toolResult';
import { nid, normalizeTodos } from '../../utils/messages';
import type { Attachment, QueuedPrompt, Role, TodoItem, UiMessage } from '../../utils/messages';
import { mergeUsageState, normalizeProfileName, profileSessionKey } from '../helpers';
import type { AgentProfile, ScopedSessionSummary } from '../types';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface GatewaySliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  hydrateSessionContext: (g: GatewayWs, sid: string) => void;
  releaseLocalTurnRef: MutableRefObject<() => void>;
  askHydrationRef: MutableRefObject<number>;
  notificationDrainRef: MutableRefObject<(() => void) | null>;
  pendingNotificationResponsesRef: MutableRefObject<HermesNotificationResponse[]>;
  handledNotificationResponsesRef: MutableRefObject<Set<string>>;
  askInboxRef: MutableRefObject<AskInboxEntry[]>;
  askRef: MutableRefObject<ServerAsk | null>;
  setAskInbox: Dispatch<SetStateAction<AskInboxEntry[]>>;
  setAsk: Dispatch<SetStateAction<ServerAsk | null>>;
  bindAskOwner: (runtimeSessionId: string, owner: AskOwner) => void;
  resolveAskOwner: (sessionIdValue?: string, params?: Record<string, unknown>) => AskOwner;
  applyAskInbox: (input: AskInboxInput) => ReturnType<typeof upsertAsk>;
  markAskByRpc: (rpcId: string, status: AskInboxStatus) => void;
  dismissAskNotifications: (entries?: AskInboxEntry[]) => void;
  draftsRef: MutableRefObject<Map<string, string>>;
  setInputRaw: Dispatch<SetStateAction<string>>;
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  queuedRef: MutableRefObject<QueuedPrompt[]>;
  setQueued: Dispatch<SetStateAction<QueuedPrompt[]>>;
  queueParkedRef: MutableRefObject<boolean>;
  setQueueParked: Dispatch<SetStateAction<boolean>>;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  liveTools: MutableRefObject<Map<string, string>>;
  liveToolAid: MutableRefObject<string | null>;
  liveTurnTools: MutableRefObject<string[]>;
  liveTurnDiffs: MutableRefObject<string[]>;
  streamingRef: MutableRefObject<Record<string, string>>;
  setStreamingTexts: Dispatch<SetStateAction<Record<string, string>>>;
  turnOwnerRef: MutableRefObject<Map<string, string>>;
  parkedLiveRef: MutableRefObject<Set<string>>;
  lastTurnEventAt: MutableRefObject<number>;
  notifyRef: MutableRefObject<boolean>;
  usageRefreshRef: MutableRefObject<() => void>;
  setUsageInfo: Dispatch<SetStateAction<any>>;
  setSessionInfo: Dispatch<SetStateAction<any>>;
  toolRefreshRef: MutableRefObject<() => void>;
  scheduleToolRefresh: () => void;
  setTodos: Dispatch<SetStateAction<TodoItem[]>>;
  setModel: Dispatch<SetStateAction<string>>;
  setModelProvider: Dispatch<SetStateAction<string>>;
  setConn: Dispatch<SetStateAction<ConnState>>;
  setAuthed: Dispatch<SetStateAction<boolean>>;
  setProfiles: Dispatch<SetStateAction<AgentProfile[]>>;
  setActiveProfile: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setToolLine: Dispatch<SetStateAction<string | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setSessionKey: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setSessions: Dispatch<SetStateAction<ScopedSessionSummary[]>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setPassword: (value: string) => void;
  setProviders: Dispatch<SetStateAction<ModelProviderOption[] | null>>;
}

export interface GatewaySlice {
  probeWorkingSessions: () => Promise<Set<string> | null>;
  confirmAfterReconnect: () => Promise<void>;
  syncOpenRequests: (g: GatewayWs) => Promise<void>;
  openWs: (h: string, user: string) => Promise<GatewayWs>;
}

export function useGatewaySlice(deps: GatewaySliceDeps): GatewaySlice {
  const {
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
    messagesRef,
    sessionIdRef,
    resyncRef,
    drainRef,
    stampRowIdsRef,
    profilesRef,
    contextPendingSidRef,
  } = runtime;

  // Ask the backend which sessions are actually working right now (desktop
  // parity: the `session.active_list` snapshot behind confirmReconnectSettlesExcept).
  // Returns null when the backend has no such method — callers fall back to timeouts.
  // Only refs + gw.current, so stable across renders and safe inside frozen WS handlers.
  const probeWorkingSessions = useCallback(async (): Promise<Set<string> | null> => {
    const g = gw.current;
    if (!g) return null;
    try {
      const rows = await g.activeList(sessionIdRef.current ?? undefined);
      const working = new Set<string>();
      for (const r of rows) {
        // `waiting` (pending approval/input) is still live — desktop never retires needsInput.
        if (r.status === 'working' || r.status === 'waiting' || r.status === 'starting') {
          if (!r.id) continue;
          const owner =
            runtimeOwners.current.get(r.id) ??
            (r.id === sessionIdRef.current ? profileSessionKey(activeProfileRef.current, r.id) : null);
          if (owner) working.add(owner);
        }
      }
      return working;
    } catch {
      return null;
    }
  }, []);

  // Post-reconnect reconcile (desktop parity: reconcileBusyStatesOnReconnect).
  // A respawned backend re-mints runtime ids, so a pre-drop `busy` can never get
  // its terminal publish — confirm parked latches against the snapshot instead
  // of letting them lie forever. A still-live turn re-asserts on its next event.
  const confirmAfterReconnect = useCallback(async () => {
    if (parkedLiveRef.current.size === 0 && !generatingRef.current) return;
    const connectionEpoch = connectionEpochRef.current;
    const working = await probeWorkingSessions();
    if (connectionEpochRef.current !== connectionEpoch) return;
    if (!working) return; // can't confirm — leave everything, the watchdog still covers it
    for (const key of [...parkedLiveRef.current]) {
      if (!working.has(key)) parkedLiveRef.current.delete(key);
    }
    const stored = latest.current.sessionKey;
    const runtime = sessionIdRef.current;
    const cur = stored
      ? profileSessionKey(latest.current.activeProfile, stored)
      : runtime
        ? (runtimeOwners.current.get(runtime) ?? profileSessionKey(latest.current.activeProfile, runtime))
        : null;
    if (generatingRef.current && cur && !working.has(cur)) {
      releaseLocalTurnRef.current();
      resyncRef.current();
    }
  }, [probeWorkingSessions]);

  // Hydrate server asks from every live session that is waiting for input, but
  // do not replay its transcript events into the visible chat. This is the
  // background half of the owner model and is deliberately best-effort on
  // older gateways without `session.active_list`.
  const syncOpenRequests = useCallback(async (g: GatewayWs) => {
    const connectionEpoch = connectionEpochRef.current;
    const hydration = ++askHydrationRef.current;
    try {
      const ids = new Set<string>();
      if (sessionIdRef.current) ids.add(sessionIdRef.current);
      for (const entry of askInboxRef.current) {
        if (
          (entry.status === 'pending' || entry.status === 'answering' || entry.status === 'sent') &&
          entry.owner.runtimeSessionId
        ) {
          ids.add(entry.owner.runtimeSessionId);
        }
      }
      let activeListAvailable = false;
      const unresolvedRows: Array<{ id: string; sessionKey: string }> = [];
      try {
        const active = await g.activeList(sessionIdRef.current ?? undefined);
        if (connectionEpochRef.current !== connectionEpoch) return;
        activeListAvailable = true;
        for (const row of active) {
          if (connectionEpochRef.current !== connectionEpoch) return;
          if (!row.id) continue;
          const currentStoredKey = latest.current.sessionKey;
          const hintedProfile = row.profile ? normalizeProfileName(row.profile) : '';
          const currentProfile = normalizeProfileName(activeProfileRef.current);
          const profileMatchesCurrent =
            hintedProfile === currentProfile || (!hintedProfile && profilesRef.current.length <= 1);
          const isCurrent =
            row.id === sessionIdRef.current ||
            (!!sessionIdRef.current &&
              !!currentStoredKey &&
              profileMatchesCurrent &&
              row.sessionKey === currentStoredKey);
          if (row.status === 'waiting' || isCurrent) ids.add(row.id);
          if (row.sessionKey) {
            const profile = hintedProfile || (profilesRef.current.length === 1 ? currentProfile : '');
            const owner: AskOwner = {
              connectionId: connectionScope(latest.current.host, latest.current.username),
              profile: isCurrent ? normalizeProfileName(activeProfileRef.current) : profile,
              storedSessionId: row.sessionKey,
              runtimeSessionId: row.id,
              resolved: Boolean(isCurrent || (profile && row.sessionKey)),
            };
            const existing = runtimeAskOwners.current.get(row.id);
            if (!existing?.resolved) runtimeAskOwners.current.set(row.id, owner);
            if (!isCurrent && !owner.resolved) unresolvedRows.push({ id: row.id, sessionKey: row.sessionKey });
            const scopedOwner = owner.resolved ? profileSessionKey(owner.profile, row.sessionKey) : '';
            if (isCurrent) {
              runtimeOwners.current.set(row.id, profileSessionKey(activeProfileRef.current, row.sessionKey));
              if (row.id !== sessionIdRef.current) {
                // The gateway can remint a live runtime after a process restart.
                // Adopt the new id only for the same durable room, then rebuild
                // the foreground transcript from REST.
                sessionIdRef.current = row.id;
                setSessionId(row.id);
                resyncRef.current();
              }
            } else if (scopedOwner && parkedLiveRef.current.has(scopedOwner))
              runtimeOwners.current.set(row.id, scopedOwner);
          }
        }
      } catch {
        // Keep the known runtime owners when active_list is unavailable.
      }
      if (unresolvedRows.length > 0 && profilesRef.current.length > 0) {
        for (const row of unresolvedRows) {
          const matches: string[] = [];
          for (const profile of profilesRef.current) {
            try {
              const rows = await g.listSessions(100, profile.name);
              if (connectionEpochRef.current !== connectionEpoch) return;
              if (rows.some((item) => item.id === row.sessionKey)) matches.push(profile.name);
            } catch {
              // Try the next known profile; never guess from the stored id.
            }
          }
          if (matches.length !== 1) continue;
          const owner: AskOwner = {
            connectionId: connectionScope(latest.current.host, latest.current.username),
            profile: matches[0],
            storedSessionId: row.sessionKey,
            runtimeSessionId: row.id,
            resolved: true,
          };
          runtimeAskOwners.current.set(row.id, owner);
          bindAskOwner(row.id, owner);
        }
      }
      if (connectionEpochRef.current !== connectionEpoch) return;
      if (!activeListAvailable) {
        for (const runtime of runtimeOwners.current.keys()) ids.add(runtime);
      }
      if (ids.size > 0) await g.syncOpenRequests([...ids]);
    } finally {
      if (askHydrationRef.current === hydration) askHydrationRef.current = 0;
      notificationDrainRef.current?.();
    }
  }, []);

  const openWs = useCallback(
    async (h: string, user: string): Promise<GatewayWs> => {
      const connectionEpoch = connectionEpochRef.current;
      const scope = connectionScope(h, user);
      const isConnectionCurrent = () => connectionEpochRef.current === connectionEpoch;
      const updateCookie = (nextCookie: string) => {
        if (!isConnectionCurrent()) return;
        cookie.current = nextCookie;
        cookieScope.current = scope;
        void saveCookie(nextCookie, h, user);
      };
      const ticket = await mintWsTicket(h, cookie.current, updateCookie);
      if (!isConnectionCurrent()) throw new Error('Connection superseded');
      // Events carry the runtime session id. Only the active profile's foreground
      // runtime may touch the transcript. During a profile switch there is
      // intentionally no current runtime until session.create resolves, so every
      // session-scoped event is ignored during that gap.
      const isCurrentSession = (sid: string) => !sid || (!!sessionIdRef.current && sid === sessionIdRef.current);
      let ws: GatewayWs;
      ws = new GatewayWs({
        wsUrl: toWsUrl(h, ticket),
        refreshUrl: async () => {
          try {
            if (!isConnectionCurrent() || cookieScope.current !== scope) {
              throw new Error('Connection superseded');
            }
            const t = await mintWsTicket(h, cookie.current, updateCookie);
            if (!isConnectionCurrent()) throw new Error('Connection superseded');
            return toWsUrl(h, t);
          } catch (e: any) {
            if (typeof e?.cookie === 'string' && e.cookie) updateCookie(e.cookie);
            throw e;
          }
        },
        // Replay missed events only for the session the app is showing.
        replaySessions: () => (sessionIdRef.current ? [sessionIdRef.current] : []),
        events: {
          onState: (s) => {
            if (connectionEpochRef.current !== connectionEpoch) return;
            setConn(s);
            if (s === 'auth-expired') {
              connectionEpochRef.current += 1;
              connectRequestRef.current += 1;
              profileEpochRef.current += 1;
              gw.current?.close();
              if (gw.current === ws) gw.current = null;
              setAuthed(false);
              setConn('idle');
              setProfiles([]);
              draftsRef.current.clear();
              setInputRaw('');
              queuedRef.current = [];
              setQueued([]);
              queueParkedRef.current = false;
              setQueueParked(false);
              setAttachments([]);
              setProviders(null);
              setToolLine(null);
              activeProfilePreferenceRef.current = null;
              activeProfileRef.current = DEFAULT_PROFILE;
              setActiveProfile(DEFAULT_PROFILE);
              setError('Gateway session expired — sign in again.');
              dismissAskNotifications();
              askInboxRef.current = [];
              setAskInbox([]);
              pendingNotificationResponsesRef.current = [];
              askHydrationRef.current = 0;
              handledNotificationResponsesRef.current.clear();
              askRef.current = null;
              setAsk(null);
              sessionIdRef.current = null;
              setSessionId(null);
              setSessionKey(null);
              setMessages([]);
              setSessions([]);
              setUsageInfo(null);
              setSessionInfo(null);
              setGenerating(false);
              runtimeOwners.current.clear();
              runtimeAskOwners.current.clear();
              turnOwnerRef.current.clear();
              parkedLiveRef.current.clear();
              cookie.current = '';
              cookieScope.current = '';
              clearMediaCaches();
              clearSessionMessagesCache();
              setPassword('');
              const cleanup = (async () => {
                try {
                  await forgetAll(h, user);
                } catch {}
              })();
              logoutCleanupRef.current = cleanup;
              void cleanup;
              router.replace('/login');
              return;
            }
            if (s === 'ready') {
              void (async () => {
                await syncOpenRequests(ws);
                await confirmAfterReconnect();
              })();
            }
          },
          onToken: (sid, delta) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            const aid = liveAid.current;
            if (!aid || !delta) return;
            lastTurnEventAt.current = Date.now();
            // O(1): buffer outside `messages`, no transcript map per delta.
            // Update the ref synchronously — onComplete may fire before React re-renders.
            const next = {
              ...streamingRef.current,
              [aid]: (streamingRef.current[aid] ?? '') + delta,
            };
            streamingRef.current = next;
            setStreamingTexts(next);
          },
          onReasoning: (sid, delta) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            let aid = liveThinkAid.current;
            if (!aid) {
              aid = nid();
              liveThinkAid.current = aid;
              const id = aid;
              const aiId = liveAid.current;
              setMessages((prev) => {
                // Thinking reads first — pin it ABOVE the pending answer bubble.
                const think = { id, role: 'thinking' as Role, text: '' };
                const aiIdx = aiId ? prev.findIndex((m) => m.id === aiId) : -1;
                if (aiIdx === -1) return [...prev, think];
                return [...prev.slice(0, aiIdx), think, ...prev.slice(aiIdx)];
              });
              if (!delta) return;
            }
            const id = aid;
            if (!delta) return;
            lastTurnEventAt.current = Date.now();
            const next = {
              ...streamingRef.current,
              [id]: (streamingRef.current[id] ?? '') + delta,
            };
            streamingRef.current = next;
            setStreamingTexts(next);
          },
          onInterim: (sid, text) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            lastTurnEventAt.current = Date.now();
            // Interim status belongs ABOVE the streaming answer chronologically —
            // pin it before the pending bubble (same as thinking), else it lands
            // below the final answer.
            const aiId = liveAid.current;
            setMessages((prev) => {
              const item = { id: nid(), role: 'interim' as Role, text };
              const aiIdx = aiId ? prev.findIndex((m) => m.id === aiId) : -1;
              if (aiIdx === -1) return [...prev, item];
              return [...prev.slice(0, aiIdx), item, ...prev.slice(aiIdx)];
            });
          },
          onTool: (sid, info) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            lastTurnEventAt.current = Date.now();
            if (info.phase === 'complete') {
              setToolLine(null);
              const mid = (info.toolId && liveTools.current.get(info.toolId)) || liveToolAid.current;
              if (mid) {
                const detail = info.summary || undefined;
                // Keep the diff the gateway rendered for a file edit (it survives
                // the summary line) so the tool bubble can show it inline.
                const diff = info.inlineDiff || undefined;
                if (diff) liveTurnDiffs.current.push(diff);
                // And the RESULT itself — that's the body the expanded bubble shows.
                const output = info.result !== undefined ? formatToolResult(info.result) || undefined : undefined;
                const command = formatToolCommand(info.args) || info.context || undefined;
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === mid
                      ? {
                          ...m,
                          pending: false,
                          ...(detail ? { detail } : {}),
                          ...(diff ? { diff } : {}),
                          ...(output ? { output } : {}),
                          ...(command && !m.command ? { command } : {}),
                        }
                      : m,
                  ),
                );
                if (info.toolId) liveTools.current.delete(info.toolId);
                if (liveToolAid.current === mid) liveToolAid.current = null;
                // Fill the result/diff from REST shortly after (covers backends whose
                // tool.complete predates the `result` field).
                scheduleToolRefresh();
              }
              return;
            }
            setToolLine(info.name ? `⚙ ${info.name}…` : '⚙ running tool…');
            // The command/primary arg rides `args` on tool.start (full) or `context`
            // (80-char preview) as a fallback.
            const command = formatToolCommand(info.args) || info.context || undefined;
            const existing = (info.toolId && liveTools.current.get(info.toolId)) || liveToolAid.current;
            if (existing) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === existing
                    ? {
                        ...m,
                        text: info.name || m.text,
                        detail: info.preview || m.detail,
                        ...(command && !m.command ? { command } : {}),
                      }
                    : m,
                ),
              );
              return;
            }
            const id = nid();
            if (info.toolId) liveTools.current.set(info.toolId, id);
            else liveToolAid.current = id;
            liveTurnTools.current.push(id);
            const aiId = liveAid.current;
            const item: UiMessage = {
              id,
              role: 'tool',
              text: info.name || 'tool',
              pending: true,
              ...(info.preview ? { detail: info.preview } : {}),
              ...(command ? { command } : {}),
            };
            setMessages((prev) => {
              const aiIdx = aiId ? prev.findIndex((m) => m.id === aiId) : -1;
              if (aiIdx === -1) return [...prev, item];
              return [...prev.slice(0, aiIdx), item, ...prev.slice(aiIdx)];
            });
          },
          onComplete: (sid, text) => {
            if (connectionEpochRef.current !== connectionEpoch) return;
            // Background turn finished — drop its parked latch (the visible room is untouched).
            const owner = turnOwnerRef.current.get(sid);
            turnOwnerRef.current.delete(sid);
            if (owner) {
              parkedLiveRef.current.delete(owner);
            } else if (isCurrentSession(sid) && latest.current.sessionKey) {
              parkedLiveRef.current.delete(profileSessionKey(latest.current.activeProfile, latest.current.sessionKey));
            }
            if (!isCurrentSession(sid)) {
              if (notifyRef.current) {
                void pushNotification('Hermes finished', 'Background turn complete');
              }
              return;
            }
            const aid = liveAid.current;
            const thinkId = liveThinkAid.current;
            liveAid.current = null;
            liveThinkAid.current = null;
            liveTurnTools.current = [];
            setGenerating(false);
            // onComplete runs before React re-renders, so flip the ref too or the
            // drain below would see a stale "generating" and bail.
            generatingRef.current = false;
            setToolLine(null);
            // Single merge: fold buffered deltas into the durable transcript once.
            const deltas = streamingRef.current;
            const hasDeltas = (aid && deltas[aid] !== undefined) || (thinkId && deltas[thinkId] !== undefined);
            if (aid || thinkId || text) {
              const base = messagesRef.current;
              let next: UiMessage[];
              if (hasDeltas) {
                next = base.map((m) => {
                  const d = deltas[m.id];
                  if (d === undefined) return m;
                  // Server text wins when present, else keep streamed buffer.
                  const finalText = m.id === aid && text ? text : m.text + d;
                  return { ...m, text: finalText, pending: false };
                });
              } else if (aid) {
                next = base.map((m) => (m.id === aid ? { ...m, text: text || m.text, pending: false } : m));
              } else {
                next = base;
              }
              if (!aid && text) {
                next = [...next, { id: nid(), role: 'assistant', text }];
              }
              messagesRef.current = next;
              setMessages(next);
            }
            streamingRef.current = {};
            setStreamingTexts((prev) => (Object.keys(prev).length ? {} : prev));
            // End-of-turn file summary: fold every inline diff this turn produced.
            const turnDiffs = liveTurnDiffs.current;
            liveTurnDiffs.current = [];
            if (turnDiffs.length) {
              const files = new Map<string, { added: number; removed: number }>();
              for (const d of turnDiffs) {
                for (const f of changedFilesFromDiff(d)) {
                  const cur = files.get(f.path) ?? { added: 0, removed: 0 };
                  cur.added += f.added;
                  cur.removed += f.removed;
                  files.set(f.path, cur);
                }
              }
              if (files.size) {
                let added = 0;
                let removed = 0;
                for (const v of files.values()) {
                  added += v.added;
                  removed += v.removed;
                }
                const n = files.size;
                const names = [...files.keys()].map((p) => p.split('/').pop() || p);
                const tail = names.length <= 3 ? ` · ${names.join(', ')}` : '';
                setMessages((prev) => [
                  ...prev,
                  {
                    id: nid(),
                    role: 'summary',
                    text: `${n} file${n === 1 ? '' : 's'} · +${added} −${removed}${tail}`,
                  },
                ]);
              }
            }
            // Backfill full tool RESULT content from the REST transcript.
            toolRefreshRef.current();
            // Stamp durable row ids so the new turn is editable/regenerable.
            stampRowIdsRef.current();
            // Turn ended — send the next queued prompt, if any.
            drainRef.current();
            // Refresh the status strip's context/token numbers.
            usageRefreshRef.current();
            if (notifyRef.current) {
              void pushNotification('Hermes finished', 'Turn complete');
            }
          },
          onNotice: (sid, text) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            setMessages((prev) => [...prev, { id: nid(), role: 'notice', text }]);
          },
          onSessionInfo: (sid, info) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            setSessionInfo(info);
            if (info?.usage) setUsageInfo((prev: any) => mergeUsageState(prev, info.usage));
            if (contextPendingSidRef.current === sid && gw.current) {
              hydrateSessionContext(gw.current, sid);
            }
            // Server truth wins when present (e.g. the global default changed on
            // desktop) — and persists for the next boot.
            if (info && typeof info.model === 'string' && info.model) {
              const prov = typeof info.provider === 'string' ? info.provider : '';
              setModelProvider(prov);
              setModel(info.model);
              void saveModel(
                prov,
                info.model,
                latest.current.activeProfile,
                connectionScope(latest.current.host, latest.current.username),
              );
            }
          },
          onUsage: (sid, usage) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            setUsageInfo((prev: any) => mergeUsageState(prev, usage));
          },
          onTodo: (sid, payload) => {
            if (connectionEpochRef.current !== connectionEpoch || !isCurrentSession(sid)) return;
            setTodos(normalizeTodos(payload));
          },
          onReplayTruncated: (sid) => {
            if (connectionEpochRef.current !== connectionEpoch) return;
            // Only the session on screen shares our transcript state.
            if (sid === sessionIdRef.current) resyncRef.current();
          },
          onAsk: (a) => {
            if (connectionEpochRef.current !== connectionEpoch) return;
            const owner = resolveAskOwner(a.sessionId, a.params);
            const result = applyAskInbox({
              rpcId: a.rpcId,
              method: a.method,
              sessionId: a.sessionId,
              params: a.params,
              owner,
              replayed: a.replayed === true,
            });
            const isCurrent = !a.sessionId || isCurrentSession(a.sessionId);
            // Never hijack the visible room with a background request. Also do
            // not resurrect a settled card from a late/replayed frame.
            if (isCurrent && (result.entry.status === 'pending' || result.entry.status === 'answering')) {
              setAsk(a);
            } else if (isCurrent && askRef.current?.rpcId === a.rpcId) {
              setAsk(null);
            }
            if (notifyRef.current && result.added && !a.replayed) {
              const what =
                a.method === 'approval'
                  ? 'Command approval needed'
                  : a.method === 'clarify'
                    ? 'A question needs your answer'
                    : a.method === 'sudo'
                      ? 'Sudo password required'
                      : a.method === 'secret'
                        ? 'A secret is required'
                        : a.method.startsWith('vault.')
                          ? 'Vault unlock required'
                          : 'Hermes needs input';
              void pushNotification('Hermes', what, {
                identifier: `hermes-ask-${result.entry.rpcId}`,
                categoryIdentifier: askNotificationCategory(a.method),
                data: {
                  kind: 'ask',
                  connectionId: result.entry.owner.connectionId,
                  askKey: result.entry.key,
                  rpcId: result.entry.rpcId,
                  method: result.entry.method,
                  runtimeSessionId: result.entry.owner.runtimeSessionId,
                  storedSessionId: result.entry.owner.storedSessionId,
                  profile: result.entry.owner.profile,
                },
              });
            }
            // A cold-start notification action can arrive before its open request
            // has been rehydrated. Drain it after every ask delivery.
            notificationDrainRef.current?.();
          },
          onAskCancel: (rpcId, info) => {
            if (connectionEpochRef.current !== connectionEpoch) return;
            markAskByRpc(rpcId, 'cancelled');
            if (
              askRef.current?.rpcId === rpcId &&
              (!info?.sessionId || !askRef.current.sessionId || info.sessionId === askRef.current.sessionId)
            ) {
              setAsk(null);
            }
          },
          onAskSnapshot: (sid, rpcIds, snapshotAt) => {
            if (connectionEpochRef.current !== connectionEpoch) return;
            const open = new Set(rpcIds);
            const next = askInboxRef.current.map((entry) => {
              const belongs = entry.owner.runtimeSessionId === sid || entry.sessionId === sid;
              const wasPresentAtSnapshot = entry.receivedAt <= snapshotAt;
              return belongs &&
                wasPresentAtSnapshot &&
                (entry.status === 'pending' || entry.status === 'answering' || entry.status === 'sent') &&
                !open.has(entry.rpcId)
                ? {
                    ...entry,
                    status: entry.status === 'sent' ? ('answered' as const) : ('cancelled' as const),
                  }
                : entry;
            });
            for (const before of askInboxRef.current) {
              const after = next.find(
                (entry) => entry.rpcId === before.rpcId && entry.owner.connectionId === before.owner.connectionId,
              );
              if (
                after &&
                (after.status === 'cancelled' || after.status === 'stale') &&
                before.status !== after.status
              ) {
                void dismissNotification(`hermes-ask-${before.rpcId}`);
              }
            }
            askInboxRef.current = next;
            setAskInbox(next);
            if (askRef.current?.sessionId === sid && !open.has(askRef.current.rpcId)) setAsk(null);
          },
        },
      });
      return ws;
    },
    [hydrateSessionContext, confirmAfterReconnect, syncOpenRequests, resolveAskOwner, applyAskInbox, markAskByRpc],
  );

  return { probeWorkingSessions, confirmAfterReconnect, syncOpenRequests, openWs };
}
