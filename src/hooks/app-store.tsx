// Global app state — the full logic of the old monolithic AppInner
// (App.tsx), lifted into a context provider so the expo-router screens
// (login / sessions / chat) share one connection, one gateway socket and
// one transcript. Navigation replaced setScreen() with expo-router routes.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, useColorScheme as useSystemScheme } from 'react-native';
import * as LocalAuth from 'expo-local-authentication';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { readAsStringAsync } from 'expo-file-system/legacy';
import { useColorScheme as useNWColorScheme } from 'nativewind';
import {
  checkMe,
  getModelOptions,
  getSessionMessages,
  mintWsTicket,
  opsGet as dashboardOpsGet,
  opsMut as dashboardOpsMut,
  passwordLogin,
  probeStatus,
  setMainModel,
  toWsUrl,
} from '../lib/dashboard';
import type { ModelProviderOption } from '../lib/dashboard';
import { clearCookie, getActiveProfile, getCookie, getLastSession, getModel, getNotifyEnabled, getPassword, getTheme, loadConnection, saveActiveProfile, saveCookie, saveHost, saveLastSession, saveModel, saveNotifyEnabled, savePassword, saveTheme } from '../lib/connection';
import type { ResolvedTheme, Theme } from '../lib/connection';
import {
  askNotificationCategory,
  dismissNotification,
  ensureAndroidChannel,
  ensureNotificationCategories,
  NOTIFICATION_ASK_ANSWER,
  NOTIFICATION_ASK_APPROVE,
  NOTIFICATION_ASK_OPEN,
  NOTIFICATION_ASK_REJECT,
  NOTIFICATION_DEFAULT_ACTION,
  notifyPermissionGranted,
  onNotificationResponse,
  pushNotification,
  requestNotifyPermission,
} from '../lib/notifications';
import {
  askKey,
  findAsk,
  findAskByRpc,
  pendingAsks,
  setAskStatus,
  setAskStatusByRpc,
  upsertAsk,
} from '../lib/ask-inbox';
import type { AskInboxEntry, AskInboxInput, AskInboxStatus, AskOwner } from '../lib/ask-inbox';
import type { HermesNotificationResponse } from '../lib/notifications';
import { GatewayWs } from '../lib/gateway-ws';
import type { ConnState, HistoryMessage, ServerAsk, SessionSummary } from '../lib/gateway-ws';
import { changedFilesFromDiff, inlineDiffFromDetail } from '../utils/diff';
import { formatToolCommand, formatToolResult } from '../utils/toolResult';
import {
  cleanThinking,
  errMsg,
  isSlashCommand,
  nid,
  parseSlashCommand,
  utf8ToBase64,
} from '../utils/messages';
import {
  rememberCommandsCatalog,
  slashBlockedMessage,
  slashMobileAction,
  slashMobileHint,
} from '../utils/slash-commands';
import type { Attachment, QueuedPrompt, SubagentRow, TodoItem, UiMessage } from '../utils/messages';
import { normalizeSubagents, normalizeTodos } from '../utils/messages';
import type { Role } from '../utils/messages';

export interface AppStore {
  booting: boolean;
  authed: boolean;
  busy: boolean;
  error: string | null;
  host: string;
  setHost: (v: string) => void;
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  conn: ConnState;
  /** Gateway profile currently selected for Chat and profile-aware screens. */
  activeProfile: string;
  profiles: AgentProfile[];
  refreshProfiles: () => Promise<void>;
  switchProfile: (profile: string) => Promise<void>;
  sessions: ScopedSessionSummary[];
  openingId: string | null;
  sessionId: string | null;
  /** Stored DB id (session.list id) — stable across resumes, used for highlight. */
  sessionKey: string | null;
  sessionTitle: string;
  messages: UiMessage[];
  /** Live streaming deltas by bubble id — kept outside `messages` so per-token
   *  updates are O(1) instead of mapping the whole transcript. Merged into
   *  `messages` once on turn end (desktop parity: hot state local, durable
   *  transcript appended, not rewritten). */
  streamingTexts: Record<string, string>;
  input: string;
  setInput: (v: string) => void;
  model: string;
  modelProvider: string;
  effort: string;
  setEffort: (v: string) => void;
  /** Apply a thinking-effort level to the live session (and the next create). */
  applyEffort: (level: string) => Promise<void>;
  /** Toggle fast mode on the live session. */
  applyFast: (on: boolean) => Promise<void>;
  providers: ModelProviderOption[] | null;
  providersLoading: boolean;
  providersError: string | null;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
  generating: boolean;
  copiedId: string | null;
  infoOpen: boolean;
  setInfoOpen: (v: boolean) => void;
  infoSeq: number;
  sessionInfo: any;
  usageInfo: any;
  usageLoading: boolean;
  toolLine: string | null;
  ask: ServerAsk | null;
  /** All unresolved/settled server asks, newest first. */
  askInbox: AskInboxEntry[];
  pendingAskCount: number;
  /** Open an inbox item in its owning chat when its profile is resolved. */
  openAskEntry: (entry: AskInboxEntry) => Promise<void>;
  answerInboxValue: (key: string, value: string) => boolean;
  answerInboxApproval: (key: string, choice: string) => boolean;
  connect: (h: string, user: string, pw: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSessions: (limit?: number) => Promise<ScopedSessionSummary[]>;
  /** Fetch the next page (limit+100) — used by drawer infinite scroll. */
  loadMoreSessions: () => Promise<ScopedSessionSummary[]>;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
  openSession: (s: ScopedSessionSummary) => Promise<void>;
  newSession: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
  openInfo: () => Promise<void>;
  getGw: () => GatewayWs | null;
  /** Connection + WS diagnostics snapshot (Settings → Diagnostics). */
  diagnostics: () => Record<string, unknown>;
  loadProviders: () => Promise<void>;
  loadCommandsCatalog: () => Promise<void>;
  /** Prompts typed mid-turn, drained one per turn end. */
  queued: QueuedPrompt[];
  /** True after an explicit Stop — the queue waits for Resume/re-queue. */
  queueParked: boolean;
  enqueueQueued: (text: string) => void;
  removeQueued: (id: string) => void;
  clearQueue: () => void;
  resumeQueue: () => void;
  sendQueuedNow: (id: string) => void;
  /** Row id of the message being edited (rewind target), or null. */
  editingRowId: number | null;
  /** Put a user message back in the composer for edit & resend. */
  editMessage: (id: string) => void;
  cancelEdit: () => void;
  /** Rerun the last user turn (rewind + resubmit). */
  regenerate: () => void;
  /** Spill a large paste to a server file and insert its placeholder. */
  pasteLarge: (text: string) => void;
  /** Set the persistent dangerous-command approval mode. */
  applyApprovalMode: (mode: 'manual' | 'smart' | 'off') => Promise<void>;
  /** Fork the current session into a copy and open it. */
  branchSession: () => Promise<void>;
  /** Local notifications (turn complete / asks while backgrounded). */
  notificationsEnabled: boolean;
  setNotifications: (on: boolean) => Promise<void>;
  /** Agent's live todo list (`todo.updated`), for the checklist above the composer. */
  todos: TodoItem[];
  /** Live child agents (polled from `subagent.list` while a turn runs). */
  subagents: SubagentRow[];
  /** Re-fetch tool results from the REST transcript (fills expanded tool bubbles). */
  refreshToolResults: () => void;
  pickModel: (providerSlug: string, modelId: string) => Promise<void>;
  copyText: (id: string, text: string) => Promise<void>;
  answerValue: (value: string) => void;
  answerApproval: (choice: string) => boolean;
  /** Reply to the current foreground ask with its method-specific result. */
  answerAsk: (result: Record<string, unknown>) => boolean;
  dismissAsk: () => void;
  /** Effective theme after resolving `system`. */
  theme: ResolvedTheme;
  /** Persisted user preference: light, dark, or follow the device. */
  themeMode: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
  renameSession: (title: string) => Promise<void>;
  deleteSessionById: (storedId: string) => Promise<void>;
  closeCurrent: () => Promise<void>;
  redirectLive: (text: string) => Promise<void>;
  setGlobalModel: (providerSlug: string, modelId: string) => Promise<void>;
  jumpToRecent: () => Promise<void>;
  opsGet: (path: string) => Promise<any>;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<any>;
  /** Session cookie — media components need it to load authed URLs. */
  getCookie: () => string;
}

const AppContext = createContext<AppStore | null>(null);

// Rejecting timeout so a wedged server can never trap the UI on a spinner.
function withTimeout<T>(p: Promise<T>, ms: number, what = 'timed out'): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<T>((_, rej) => {
    t = setTimeout(() => rej(new Error(what)), ms);
  });
  return Promise.race([p.then((v) => {
    if (t) clearTimeout(t);
    return v;
  }, (e) => {
    if (t) clearTimeout(t);
    throw e;
  }), timeout]);
}

export interface AgentProfile {
  name: string;
  display_name?: string;
  description?: string;
  model?: string | null;
  provider?: string | null;
  is_default?: boolean;
  gateway_running?: boolean;
  [key: string]: unknown;
}

export interface ScopedSessionSummary extends SessionSummary {
  profile?: string;
}

function normalizeProfileName(name: string | null | undefined): string {
  const value = String(name ?? '').trim();
  return value || 'default';
}

function profilesOf(payload: unknown): AgentProfile[] {
  const rows = Array.isArray(payload) ? payload : Array.isArray((payload as any)?.profiles) ? (payload as any).profiles : [];
  return rows
    .filter((row: any) => row && typeof row === 'object' && typeof row.name === 'string' && row.name.trim())
    .map((row: any) => ({ ...row, name: normalizeProfileName(row.name) }));
}

async function discoverAgentProfiles(host: string, cookie: string): Promise<{ profiles: AgentProfile[]; current: string }> {
  const [listResult, currentResult] = await Promise.allSettled([
    dashboardOpsGet(host, cookie, '/api/profiles'),
    dashboardOpsGet(host, cookie, '/api/profiles/active'),
  ]);
  const rows = listResult.status === 'fulfilled' ? profilesOf(listResult.value) : [];
  const currentPayload = currentResult.status === 'fulfilled' ? currentResult.value : null;
  const current = normalizeProfileName(
    typeof currentPayload?.current === 'string' ? currentPayload.current : rows[0]?.name,
  );
  return { profiles: rows, current };
}

/** Durable session identity is profile + stored id; stored ids may collide across profiles. */
function profileSessionKey(profile: string, storedId: string): string {
  return JSON.stringify([normalizeProfileName(profile), storedId]);
}

function parseProfileSessionKey(value: string): { profile: string; storedSessionId: string } | null {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') return null;
    return { profile: parsed[0], storedSessionId: parsed[1] };
  } catch {
    return null;
  }
}

function serverAskFromInbox(entry: AskInboxEntry): ServerAsk {
  return {
    rpcId: entry.rpcId,
    method: entry.method,
    ...(entry.sessionId ? { sessionId: entry.sessionId } : {}),
    params: entry.params,
    replayed: entry.replayed,
  };
}

function notificationResponseKey(response: HermesNotificationResponse): string {
  const data = response.data ?? {};
  return JSON.stringify([
    String(data.connectionId ?? ''),
    String(data.askKey ?? ''),
    String(data.rpcId ?? ''),
    response.actionIdentifier,
    String(response.userText ?? ''),
  ]);
}

/** Keep the raw gateway usage shape in state; `readUsage` normalizes at render. */
function mergeUsageState(previous: unknown, patch: unknown): any {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return previous;
  const base =
    previous && typeof previous === 'object' && !Array.isArray(previous)
      ? (previous as Record<string, unknown>)
      : {};
  return { ...base, ...(patch as Record<string, unknown>) };
}

// A cold resume builds its agent off the response path. The breakdown RPC is
// intentionally no-wait, so retry briefly until that build can reconstruct
// context occupancy from the restored transcript.
const CONTEXT_WAKEUP_DELAYS_MS = [0, 200, 600, 1500, 3000];

function scheduleContextHydration(
  gateway: GatewayWs,
  sessionId: string,
  isCurrent: () => boolean,
  publish: (snapshot: any) => void,
  delays = CONTEXT_WAKEUP_DELAYS_MS,
): () => void {
  let stopped = false;
  const attempt = (index: number) => {
    setTimeout(async () => {
      if (stopped || !isCurrent()) return;
      try {
        const snapshot = await gateway.contextBreakdown(sessionId);
        if (stopped || !isCurrent()) return;
        if (typeof snapshot?.context_max === 'number' && snapshot.context_max > 0) {
          publish(snapshot);
          return;
        }
      } catch {
        return;
      }
      if (index + 1 < delays.length) attempt(index + 1);
    }, delays[index]);
  };
  attempt(0);
  return () => {
    stopped = true;
  };
}

// ── Attachment upload ───────────────────────────────────────────────────────
// prompt.submit is text-only, so bytes are staged through session-scoped
// file.attach/image.attach_bytes RPCs and the agent is handed the returned ref.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // raw; JSON base64 is ~4/3 bigger

const isImageAttachment = (a: Attachment) =>
  (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(a.name);

async function blobToBase64(uri: string): Promise<string> {
  const blob = await (await fetch(uri)).blob();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const s = String(reader.result ?? '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : '');
    };
    reader.readAsDataURL(blob);
  });
}

async function attachmentBytes(a: Attachment): Promise<string> {
  try {
    // file:// (or content://) URI straight off the picker.
    return await readAsStringAsync(a.uri, { encoding: 'base64' });
  } catch {
    return blobToBase64(a.uri); // blob: URIs (web)
  }
}

async function uploadAttachments(
  files: Attachment[],
  gateway: GatewayWs,
  sessionId: string,
): Promise<{ name: string; path: string; image: boolean }[]> {
  // Parallel with cap 3 — old serial for..await took N x latency.
  const out: { name: string; path: string; image: boolean }[] = new Array(files.length);
  let cursor = 0;
  const uploadOne = async (index: number) => {
    const f = files[index];
    const name = f.name.replace(/[\\/]/g, '_') || `upload-${Date.now()}-${index}`;
    const image = isImageAttachment(f);
    const b64 = await attachmentBytes(f);
    if (!b64) throw new Error(`${name}: could not read the file`);
    if (b64.length > MAX_UPLOAD_BYTES * 1.4) throw new Error(`${name}: too large (10 MB max)`);
    const dataUrl = `data:${f.mime || 'application/octet-stream'};base64,${b64}`;
    const result: any = image
      ? await gateway.call('image.attach_bytes', {
          session_id: sessionId,
          content_base64: b64,
          filename: name,
        })
      : await gateway.call('file.attach', {
          session_id: sessionId,
          name,
          data_url: dataUrl,
        });
    const path =
      typeof result?.path === 'string' && result.path
        ? result.path
        : typeof result?.ref_text === 'string' && result.ref_text
          ? result.ref_text
          : name;
    out[index] = { name, path, image };
  };
  const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
    while (cursor < files.length) {
      const i = cursor++;
      await uploadOne(i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** True when rewinding to this message wipes the whole durable transcript (the
 *  target is the first row-id-bearing turn) — the server then requires
 *  `confirm_empty_truncate` on top of `confirm_truncate`. Scoped to real
 *  turns only: thinking/tool/summary/notice rows carry no durable ids. */
function cutsWholeTranscript(list: UiMessage[], targetId: string): boolean {
  const idx = list.findIndex((m) => m.id === targetId);
  if (idx < 0) return false;
  return !list
    .slice(0, idx)
    .some((m) => (m.role === 'user' || m.role === 'assistant') && m.rowId != null);
}

/** Turn a REST/WS history transcript into transcript items — shared by opening a
 *  session and by the post-reconnect resync. */
function historyToItems(hist: HistoryMessage[]): UiMessage[] {
  const items: UiMessage[] = [];
  for (const m of hist) {
    if (m.role === 'assistant' && m.reasoning?.trim()) {
      items.push({ id: nid(), role: 'thinking', text: cleanThinking(m.reasoning) });
    }
    if (m.role === 'tool' && (m.content.trim() || m.name)) {
      const label = m.name || m.content;
      items.push({
        id: nid(),
        role: 'tool',
        text: label,
        ...(m.content.trim() ? { output: formatToolResult(m.content) } : {}),
        ...(m.command ? { command: m.command } : {}),
      });
    }
    if ((m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '') {
      items.push({
        id: nid(),
        role: m.role as 'user' | 'assistant',
        text: m.content,
        ...(m.rowId != null ? { rowId: m.rowId } : {}),
        ...(m.ts != null ? { ts: m.ts } : {}),
      });
    }
  }
  return items;
}

export function useApp(): AppStore {
  const v = useContext(AppContext);
  if (!v) throw new Error('useApp must be used inside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conn, setConn] = useState<ConnState>('idle');
  const [activeProfile, setActiveProfile] = useState('default');
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const profilesRef = useRef<AgentProfile[]>([]);
  profilesRef.current = profiles;
  const [authed, setAuthed] = useState(false);
  const [sessions, setSessions] = useState<ScopedSessionSummary[]>([]);
  const [sessionsLimit, setSessionsLimit] = useState(100);
  const [sessionsHasMore, setSessionsHasMore] = useState(true);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const sessionsLimitRef = useRef(100);
  sessionsLimitRef.current = sessionsLimit;
  const sessionsHasMoreRef = useRef(true);
  sessionsHasMoreRef.current = sessionsHasMore;
  const sessionsLoadingMoreRef = useRef(false);
  const sessionsFetchRef = useRef<Promise<ScopedSessionSummary[]> | null>(null);
  const sessionsFetchProfileRef = useRef<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null); // stored DB id — stable across resumes
  const [sessionTitle, setSessionTitle] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [streamingTexts, setStreamingTexts] = useState<Record<string, string>>({});
  const streamingRef = useRef<Record<string, string>>({});
  streamingRef.current = streamingTexts;
  const clearStreaming = useCallback(() => {
    streamingRef.current = {};
    setStreamingTexts((prev) => (Object.keys(prev).length ? {} : prev));
  }, []);
  // Park the visible room's live turn before leaving it, so coming back can
  // restore its Stop button instead of stranding Send/Stop on the wrong room.
  const parkLiveTurn = useCallback(() => {
    if (!generatingRef.current) return;
    const profile = latest.current.activeProfile;
    const stored = latest.current.sessionKey;
    const runtime = sessionIdRef.current;
    const owner = stored
      ? profileSessionKey(profile, stored)
      : runtime
        ? runtimeOwners.current.get(runtime) ?? profileSessionKey(profile, runtime)
        : null;
    if (owner) parkedLiveRef.current.add(owner);
  }, []);
  // Re-anchor streaming after a transcript rebuild while this room's turn is
  // live (REST is newer truth; the pre-switch buffer was already dropped).
  const reanchorLiveTurn = useCallback((items: UiMessage[]): UiMessage[] => {
    const tail = items[items.length - 1];
    if (tail && tail.role === 'assistant') {
      liveAid.current = tail.id;
      return items;
    }
    const rea = nid();
    liveAid.current = rea;
    return [...items, { id: rea, role: 'assistant', text: '', pending: true }];
  }, []);
  const [inputRaw, setInputRaw] = useState('');
  const [model, setModel] = useState('Muse Spark 1.3 Free');
  const [modelProvider, setModelProvider] = useState('');
  const [effort, setEffort] = useState('Xhigh');
  const [providers, setProviders] = useState<ModelProviderOption[] | null>(null);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [providersError, setProvidersError] = useState<string | null>(null);
  // `commands.catalog` dispositions live in ./slash-commands (module cache); this
  // counter only forces a re-render once the live table lands so the wheel re-filters.
  const [, setCatalogVersion] = useState(0);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [generating, setGenerating] = useState(false);
  // Client-side prompt queue (text-only) — prompts typed while the agent is
  // mid-turn, drained one per turn end. `queueParked` is set by an explicit
  // Stop and lifted by queueing again / Resume (desktop parity).
  const [queued, setQueued] = useState<QueuedPrompt[]>([]);
  const [queueParked, setQueueParked] = useState(false);
  // The agent's live todo list (`todo.updated`), shown above the composer.
  const [todos, setTodos] = useState<TodoItem[]>([]);
  // Live child agents (polled from `subagent.list` while a turn runs).
  const [subagents, setSubagents] = useState<SubagentRow[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  // Monotonic open requests — a boolean edge can get stuck `true` (e.g. a
  // present that never resolved), which would swallow every later tap because
  // the effect below only fires on change. A counter refires every time.
  const [infoSeq, setInfoSeq] = useState(0);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [usageInfo, setUsageInfo] = useState<any>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const copyTimer = useRef<any>(null);
  const [toolLine, setToolLine] = useState<string | null>(null);
  const [ask, setAsk] = useState<ServerAsk | null>(null);
  const askRef = useRef<ServerAsk | null>(null);
  askRef.current = ask;
  const [askInbox, setAskInbox] = useState<AskInboxEntry[]>([]);
  const askInboxRef = useRef<AskInboxEntry[]>([]);
  askInboxRef.current = askInbox;
  const pendingNotificationResponsesRef = useRef<HermesNotificationResponse[]>([]);
  const notificationDrainRef = useRef<(() => void) | null>(null);
  const notificationActionInFlightRef = useRef(false);
  const askHydrationRef = useRef(0);
  const handledNotificationResponsesRef = useRef<Set<string>>(new Set());
  const queueNotificationResponse = useCallback((response: HermesNotificationResponse) => {
    const key = notificationResponseKey(response);
    if (handledNotificationResponsesRef.current.has(key)) return;
    if (pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) === key)) return;
    pendingNotificationResponsesRef.current = [...pendingNotificationResponsesRef.current, response];
  }, []);
  const clearQueuedNotificationResponse = useCallback((response?: HermesNotificationResponse) => {
    if (!response) {
      pendingNotificationResponsesRef.current = [];
      return;
    }
    const key = notificationResponseKey(response);
    pendingNotificationResponsesRef.current = pendingNotificationResponsesRef.current.filter(
      (item) => notificationResponseKey(item) !== key,
    );
  }, []);
  const systemScheme = useSystemScheme();
  const systemTheme: ResolvedTheme = systemScheme === 'dark' ? 'dark' : 'light';
  // First install follows the device. An explicit saved Light/Dark choice wins.
  const [themeMode, setThemeMode] = useState<Theme>('system');
  const theme: ResolvedTheme = themeMode === 'system' ? systemTheme : themeMode;
  // Local notifications (turn complete / server asks while backgrounded).
  const [notifyEnabled, setNotifyEnabled] = useState(false);
  const { setColorScheme } = useNWColorScheme();

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !notifyRef.current) return;
      void notifyPermissionGranted().then((granted) => {
        if (!granted && notifyRef.current) setNotifyEnabled(false);
      });
    });
    return () => sub.remove();
  }, []);

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeMode(t);
      // Resolve immediately to avoid a one-frame flash; the effect below keeps
      // NativeWind synced if the device appearance changes later.
      try {
        setColorScheme(t === 'system' ? systemTheme : t);
      } catch {}
      void saveTheme(t);
    },
    [setColorScheme, systemTheme],
  );
  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);
  useEffect(() => {
    try {
      setColorScheme(theme);
    } catch {}
  }, [setColorScheme, theme]);

  const gw = useRef<GatewayWs | null>(null);
  const cookie = useRef<string>('');
  const activeProfileRef = useRef('default');
  activeProfileRef.current = activeProfile;
  const activeProfilePreferenceRef = useRef<string | null>(null);
  const profileEpochRef = useRef(0);
  const connectionEpochRef = useRef(0);
  const sessionOpenEpochRef = useRef(0);
  /** runtime session id → scoped durable owner (profile + stored id). */
  const runtimeOwners = useRef<Map<string, string>>(new Map());
  /** Best-effort runtime → owner metadata, including unresolved background profiles. */
  const runtimeAskOwners = useRef<Map<string, AskOwner>>(new Map());
  const refreshProfiles = useCallback(async () => {
    if (!host || !cookie.current) return;
    try {
      const discovered = await discoverAgentProfiles(host, cookie.current);
      setProfiles(discovered.profiles);
    } catch {}
  }, [host]);
  const uploading = useRef(false); // send() re-entrancy guard while bytes go up
  const liveAid = useRef<string | null>(null);
  const liveThinkAid = useRef<string | null>(null);
  const liveTools = useRef<Map<string, string>>(new Map());
  const liveToolAid = useRef<string | null>(null);
  const liveTurnTools = useRef<string[]>([]); // tool bubbles minted this turn, in order
  const liveTurnDiffs = useRef<string[]>([]); // inline diffs seen this turn (for the end-of-turn summary)
  // Live turns are per-session: the latch must follow the room, not the app.
  // parkedLive = stored keys with a background-live turn; turnOwner maps each
  // live runtime sid to its stored key so a background complete cleans up.
  const turnOwnerRef = useRef<Map<string, string>>(new Map());
  const parkedLiveRef = useRef<Set<string>>(new Set());
  // Last turn-event time — the watchdog below releases a stranded Stop latch.
  const lastTurnEventAt = useRef(0);
  // Live runtime session id for callbacks frozen in openWs (reconnect replay).
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  const contextHydrateCancelRef = useRef<(() => void) | null>(null);
  const contextPendingSidRef = useRef<string | null>(null);
  // Queue plumbing reads the freshest values from inside the once-created WS
  // event handlers (onComplete drains the queue before React re-renders).
  const generatingRef = useRef(false);
  const queueParkedRef = useRef(false);
  const queuedRef = useRef<QueuedPrompt[]>([]);
  const queueDrainInFlightRef = useRef(false);
  const sendRef = useRef<((text?: string) => Promise<void>) | null>(null);
  const drainRef = useRef<() => void>(() => {});
  // Live transcript, for handlers frozen in openWs (tool backfill name-checking).
  const messagesRef = useRef<UiMessage[]>([]);
  const notifyRef = useRef(false);
  generatingRef.current = generating;
  queueParkedRef.current = queueParked;
  queuedRef.current = queued;
  messagesRef.current = messages;
  notifyRef.current = notifyEnabled;
  // Latest host/profile/sessionKey for callbacks frozen in openWs (created once).
  const latest = useRef({ host, activeProfile, sessionKey });
  latest.current = { host, activeProfile, sessionKey };

  const resolveAskOwner = useCallback(
    (sessionIdValue?: string, params?: Record<string, unknown>): AskOwner => {
      const runtimeSessionId = String(sessionIdValue ?? '');
      const connectionId = latest.current.host;
      const hintedProfile = typeof params?.profile === 'string'
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
        const profile = hintedProfile || (profilesRef.current.length === 1 ? normalizeProfileName(latest.current.activeProfile) : '');
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
    },
    [],
  );

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

  const markAskByRpc = useCallback(
    (rpcId: string, status: AskInboxStatus) => {
      const next = setAskStatusByRpc(askInboxRef.current, latest.current.host, rpcId, status);
      askInboxRef.current = next;
      setAskInbox(next);
      if (status === 'cancelled' || status === 'answered' || status === 'stale') {
        const entry = next.find((item) => item.owner.connectionId === latest.current.host && item.rpcId === rpcId);
        if (entry) void dismissNotification(`hermes-ask-${entry.rpcId}`);
      }
      if (
        status !== 'pending' &&
        status !== 'answering' &&
        askRef.current?.rpcId === rpcId
      ) {
        setAsk(null);
      }
    },
    [],
  );

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

  // Tool RESULT fill from the REST transcript. The gateway's history projection
  // deliberately omits tool results (`name` + 80-char `context` + `args` only —
  // tui_gateway/session_history.py::_history_to_messages), and the live
  // `tool.complete` may predate the `result` field, so filling from REST is the
  // dependable path. Name-aware tail alignment keeps a shifted transcript from
  // pasting another call's result.
  const toolRefreshRef = useRef<() => void>(() => {});
  const toolRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  toolRefreshRef.current = () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const ck = cookie.current;
    // Web: the jar is empty (Set-Cookie is unreadable) but the browser cookie
    // still rides along via credentials:'include', so only host+key are required.
    if (!h || !sk) return;
    void (async () => {
      try {
        const items = await getSessionMessages(h, ck, sk, profile);
        if (
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch ||
          connectionEpochRef.current !== connectionEpoch ||
          latest.current.sessionKey !== sk
        )
          return;
        const restTools = items.filter((m) => m.role === 'tool' && m.content.trim());
        const liveTools = messagesRef.current.filter((m) => m.role === 'tool');
        if (restTools.length === 0 || liveTools.length === 0) return;
        const fill = new Map<string, { output?: string; diff?: string; command?: string }>();
        const used = new Set<number>();
        let r = Math.max(0, restTools.length - liveTools.length);
        for (const live of liveTools) {
          if (live.output && live.diff && live.command) continue; // already complete
          const want = live.text;
          let j = -1;
          for (let k = r; k < restTools.length && k < r + 4; k++) {
            if (!used.has(k) && want && restTools[k].name === want) {
              j = k;
              break;
            }
          }
          if (j === -1 && r < restTools.length && !used.has(r)) j = r;
          if (j === -1) continue;
          used.add(j);
          r = Math.max(r, j + 1);
          const output = formatToolResult(restTools[j].content) || undefined;
          const diff = inlineDiffFromDetail(restTools[j].content) || undefined;
          const command = restTools[j].command || undefined;
          if (output || diff || command) {
            fill.set(live.id, {
              ...(output ? { output } : {}),
              ...(diff ? { diff } : {}),
              ...(command && !live.command ? { command } : {}),
            });
          }
        }
        if (fill.size === 0) return;
        setMessages((prev) =>
          prev.map((m) => {
            const f = fill.get(m.id);
            return f ? { ...m, ...f } : m;
          }),
        );
      } catch {}
    })();
  };
  // Debounced refresh after each tool.complete so a live turn fills in results
  // (and diffs) without waiting for the whole turn to end.
  const scheduleToolRefresh = () => {
    if (toolRefreshTimer.current) clearTimeout(toolRefreshTimer.current);
    toolRefreshTimer.current = setTimeout(() => toolRefreshRef.current(), 700);
  };
  /** On-demand REST fill (the chat screen calls this when a tool bubble is
   *  expanded before the turn ended / on a backend without live results). */
  const refreshToolResults = useCallback(() => toolRefreshRef.current(), []);
  // Stamp durable row ids onto live messages (edit/rewind targets) by aligning
  // the REST transcript tail with the local transcript from the end.
  const stampRowIdsRef = useRef<() => void>(() => {});
  stampRowIdsRef.current = () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    if (!h || !sk) return;
    void (async () => {
      try {
        const items = await getSessionMessages(h, cookie.current, sk, profile);
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
  const resyncRef = useRef<() => void>(() => {});
  resyncRef.current = () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const runtime = sessionIdRef.current;
    if (!h || !sk || !runtime) return;
    void (async () => {
      try {
        const hist = await getSessionMessages(h, cookie.current, sk, profile);
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

  // Refresh the composer status strip at each turn end (session.info isn't
  // guaranteed to carry usage every turn); session.usage answers the live numbers.
  const usageRefreshRef = useRef<() => void>(() => {});
  usageRefreshRef.current = () => {
    const g = gw.current;
    const sid = sessionId;
    if (!g || !sid) return;
    void g
      .usage(sid)
      .then((info) => {
        if (sessionIdRef.current === sid) setUsageInfo((prev: any) => mergeUsageState(prev, info));
      })
      .catch(() => {});
  };
  // Live subagent roster — polled while a turn runs (subagent.list is scoped to
  // this session). Cheap: the RPC returns a small snapshot.
  useEffect(() => {
    const g = gw.current;
    if (!generating || !sessionId || !g) return;
    let live = true;
    const sameRows = (a: SubagentRow[], b: SubagentRow[]) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        const x = a[i];
        const y = b[i];
        if (x.subagent_id !== y.subagent_id || x.status !== y.status || x.tool_count !== y.tool_count || x.last_tool !== y.last_tool) return false;
      }
      return true;
    };
    const tick = () => {
      g.subagents(sessionId)
        .then((r) => {
          if (!live) return;
          const next = normalizeSubagents(r);
          // New array every tick re-renders the dock even when nothing changed.
          setSubagents((prev) => (sameRows(prev, next) ? prev : next));
        })
        .catch(() => {});
    };
    tick();
    const t = setInterval(tick, 3500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [generating, sessionId]);
  // Per-session composer drafts — switching rooms no longer wipes typing.
  const draftsRef = useRef<Map<string, string>>(new Map());
  const draftKeyRef = useRef<string>('__none__');
  useEffect(() => {
    const id = sessionKey ?? sessionId;
    draftKeyRef.current = id ? profileSessionKey(activeProfile, id) : `${activeProfile}::__none__`;
  }, [activeProfile, sessionKey, sessionId]);
  const setInput = useCallback((v: string) => {
    draftsRef.current.set(draftKeyRef.current, v);
    // Bound the per-session draft map — one entry per visited session otherwise.
    if (draftsRef.current.size > 50) {
      const oldest = draftsRef.current.keys().next().value;
      if (oldest !== undefined && oldest !== draftKeyRef.current) draftsRef.current.delete(oldest);
    }
    setInputRaw(v);
  }, []);
  const input = inputRaw;
  const [booting, setBooting] = useState(true);
  // Stable handle for the boot-time silent reconnect (connect is defined below).
  const connectRef = useRef<(h: string, user: string, pw: string) => Promise<void>>(async () => {});
  // openSession is defined below connect — indirect through a ref so the
  // connect callback (created first) never hits the TDZ.
  const openSessionRef = useRef<(s: SessionSummary) => Promise<void>>(async () => {});
  // Same reason as openSessionRef: send() must stay referentially stable for
  // Composer's memo(), so the mobile-local slash actions (/new, /stop, /title)
  // reach the latest handlers through refs instead of the deps array.
  const newSessionRef = useRef<() => Promise<void>>(async () => {});
  const stopRef = useRef<() => void>(() => {});
  const renameSessionRef = useRef<(t: string) => Promise<void>>(async () => {});
  // Notification taps/actions are routed through the ask inbox. The handler is
  // installed below (after response helpers exist); a cold-start response is
  // held until that handler is ready.
  useEffect(() => {
    void ensureAndroidChannel();
    void ensureNotificationCategories();
    const unsub = onNotificationResponse((response) => {
      queueNotificationResponse(response);
      notificationDrainRef.current?.();
    });
    return () => unsub?.();
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await loadConnection();
        if (cancelled) return;
        setHost(c.host);
        setUsername(c.username);
        // Prefill saved password so the user never retypes it.
        const savedPw = await getPassword().catch(() => null);
        if (cancelled) return;
        if (savedPw) setPassword(savedPw);
        const savedProfile = await getActiveProfile().catch(() => null);
        if (savedProfile) {
          const normalized = normalizeProfileName(savedProfile);
          activeProfilePreferenceRef.current = normalized;
          activeProfileRef.current = normalized;
          setActiveProfile(normalized);
        }
        // Restore the saved preference before releasing the splash gate.
        const savedTheme = await getTheme().catch(() => null);
        if (cancelled) return;
        if (savedTheme) setThemeMode(savedTheme);
        try {
          setColorScheme(savedTheme === 'system' || !savedTheme ? systemTheme : savedTheme);
        } catch {}
        // Restore the local-notifications preference.
        const savedNotify = await getNotifyEnabled().catch(() => false);
        const effectiveNotify = savedNotify ? await notifyPermissionGranted() : false;
        if (!cancelled) {
          setNotifyEnabled(effectiveNotify);
          if (savedNotify && !effectiveNotify) await saveNotifyEnabled(false);
        }
        // Restore the last picked model so the composer chip survives restarts
        // (the server global default still governs actual runs).
        const savedModel = await getModel(activeProfileRef.current).catch(() => null);
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

  // Cleanup pending timers on unmount so token/tool/copy timeouts can't fire late.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
      if (toolRefreshTimer.current) clearTimeout(toolRefreshTimer.current);
    },
    [],
  );

  const copyText = useCallback(async (id: string, text: string) => {
    try {
      await Clipboard.setStringAsync(text);
      setCopiedId(id);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  }, []);

  const ensureCookie = useCallback(async (h: string, user: string, pw: string): Promise<string> => {
    if (cookie.current) {
      try {
        if (await checkMe(h, cookie.current)) return cookie.current;
      } catch {}
      cookie.current = '';
      await clearCookie();
    }
    const stored = await getCookie();
    if (stored) {
      try {
        if (await checkMe(h, stored)) {
          cookie.current = stored;
          return stored;
        }
      } catch {}
    }
    if (!pw) throw new Error('Session expired — enter password');
    const fresh = await passwordLogin(h, user, pw);
    cookie.current = fresh;
    await saveCookie(fresh);
    return fresh;
  }, []);

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
            (r.id === sessionIdRef.current
              ? profileSessionKey(activeProfileRef.current, r.id)
              : null);
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
        ? runtimeOwners.current.get(runtime) ?? profileSessionKey(latest.current.activeProfile, runtime)
        : null;
    if (generatingRef.current && cur && !working.has(cur)) {
      releaseLocalTurn();
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
      activeListAvailable = true;
      for (const row of active) {
        if (!row.id) continue;
        const currentStoredKey = latest.current.sessionKey;
        const isCurrent =
          row.id === sessionIdRef.current ||
          (!!sessionIdRef.current && !!currentStoredKey && row.sessionKey === currentStoredKey);
        if (row.status === 'waiting' || isCurrent) ids.add(row.id);
        if (row.sessionKey) {
          const hintedProfile = row.profile ? normalizeProfileName(row.profile) : '';
          const profile = hintedProfile || (profilesRef.current.length === 1 ? normalizeProfileName(activeProfileRef.current) : '');
          const owner: AskOwner = {
            connectionId: latest.current.host,
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
          } else if (scopedOwner && parkedLiveRef.current.has(scopedOwner)) runtimeOwners.current.set(row.id, scopedOwner);
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
            if (rows.some((item) => item.id === row.sessionKey)) matches.push(profile.name);
          } catch {
            // Try the next known profile; never guess from the stored id.
          }
        }
        if (matches.length !== 1) continue;
        const owner: AskOwner = {
          connectionId: latest.current.host,
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

  const openWs = useCallback(async (h: string): Promise<GatewayWs> => {
    const connectionEpoch = connectionEpochRef.current;
    const ticket = await mintWsTicket(h, cookie.current, (nextCookie) => {
      cookie.current = nextCookie;
      void saveCookie(nextCookie);
    });    // Events carry the runtime session id. Only the active profile's foreground
    // runtime may touch the transcript. During a profile switch there is
    // intentionally no current runtime until session.create resolves, so every
    // session-scoped event is ignored during that gap.
    const isCurrentSession = (sid: string) =>
      !sid || (!!sessionIdRef.current && sid === sessionIdRef.current);
    let ws: GatewayWs;
    ws = new GatewayWs({
      wsUrl: toWsUrl(h, ticket),
      refreshUrl: async () => {
        try {
          const t = await mintWsTicket(h, cookie.current, (nextCookie) => {
            cookie.current = nextCookie;
            void saveCookie(nextCookie);
          });
          return toWsUrl(h, t);
        } catch (e: any) {
          if (typeof e?.cookie === 'string' && e.cookie) {
            cookie.current = e.cookie;
            void saveCookie(e.cookie);
          }
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
            setAuthed(false);
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
            void clearCookie();
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
          const next = { ...streamingRef.current, [aid]: (streamingRef.current[aid] ?? '') + delta };
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
          const next = { ...streamingRef.current, [id]: (streamingRef.current[id] ?? '') + delta };
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
            parkedLiveRef.current.delete(
              profileSessionKey(latest.current.activeProfile, latest.current.sessionKey),
            );
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
          const hasDeltas = aid && deltas[aid] !== undefined || thinkId && deltas[thinkId] !== undefined;
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
                { id: nid(), role: 'summary', text: `${n} file${n === 1 ? '' : 's'} · +${added} −${removed}${tail}` },
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
            void saveModel(prov, info.model, latest.current.activeProfile);
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
          if (
            isCurrent &&
            (result.entry.status === 'pending' || result.entry.status === 'answering')
          ) {
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
            return (
              belongs &&
              wasPresentAtSnapshot &&
              (entry.status === 'pending' ||
                entry.status === 'answering' ||
                entry.status === 'sent') &&
              !open.has(entry.rpcId)
            )
              ? { ...entry, status: entry.status === 'sent' ? ('answered' as const) : ('cancelled' as const) }
              : entry;
          });
          for (const before of askInboxRef.current) {
            const after = next.find((entry) => entry.rpcId === before.rpcId && entry.owner.connectionId === before.owner.connectionId);
            if (after && (after.status === 'cancelled' || after.status === 'stale') && before.status !== after.status) {
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
  }, [hydrateSessionContext, confirmAfterReconnect, syncOpenRequests, resolveAskOwner, applyAskInbox, markAskByRpc]);

  const refreshSessions = useCallback(async (limit?: number): Promise<ScopedSessionSummary[]> => {
    const g = gw.current;
    if (!g) return [];
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    // Default to the current known depth so a drawer reopen doesn't shrink
    // back to 100 after the user already scrolled deeper.
    const want = limit ?? sessionsLimitRef.current ?? 100;
    // Concurrent scroll-bottom + drawer-open refreshes share one request, but
    // a profile switch always starts a separate request for the new scope.
    if (sessionsFetchRef.current && sessionsFetchProfileRef.current === profile) {
      return sessionsFetchRef.current;
    }
    sessionsFetchRef.current = null;
    sessionsFetchProfileRef.current = null;
    let p: Promise<ScopedSessionSummary[]> | null = null;
    p = (async () => {
      try {
        const rows = await g.listSessions(want, profile);
        const s: ScopedSessionSummary[] = rows.map((row) => ({
          ...row,
          profile: (row as ScopedSessionSummary).profile ?? profile,
        }));
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return [];
        setSessions(s);
        setSessionsLimit(want);
        // session.list returns newest-first up to limit — a full page means
        // there may be older chats still on the server.
        setSessionsHasMore(s.length >= want);
        return s;
      } catch (e) {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setError(errMsg(e));
        }
        return [];
      } finally {
        if (sessionsFetchRef.current === p) {
          sessionsFetchRef.current = null;
          sessionsFetchProfileRef.current = null;
        }
      }
    })();
    sessionsFetchRef.current = p;
    sessionsFetchProfileRef.current = profile;
    return p;
  }, []);

  const loadMoreSessions = useCallback(async (): Promise<ScopedSessionSummary[]> => {
    if (sessionsLoadingMoreRef.current || !sessionsHasMoreRef.current) return [];
    const g = gw.current;
    if (!g) return [];
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    sessionsLoadingMoreRef.current = true;
    setSessionsLoadingMore(true);
    const want = Math.min((sessionsLimitRef.current ?? 100) + 100, 1000);
    try {
      const rows = await g.listSessions(want, profile);
      if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return [];
      const s: ScopedSessionSummary[] = rows.map((row) => ({
        ...row,
        profile: (row as ScopedSessionSummary).profile ?? profile,
      }));
      setSessions(s);
      setSessionsLimit(want);
      setSessionsHasMore(s.length >= want && want < 1000);
      return s;
    } catch (e) {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
        setError(errMsg(e));
      }
      return [];
    } finally {
      sessionsLoadingMoreRef.current = false;
      setSessionsLoadingMore(false);
    }
  }, []);

  // ── Model picker inventory ─────────────────────────────────────────────
  // WS model.options first (same payload as REST), cookie REST as fallback.
  const providersRef = useRef<ModelProviderOption[] | null>(null);
  providersRef.current = providers;
  const providersLoadingRef = useRef(false);
  const providersAtRef = useRef(0);
  const catalogAtRef = useRef(0);

  const loadProviders = useCallback(async () => {
    const g = gw.current;
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    if (!g || providersLoadingRef.current) return;
    // 30s TTL — the model popover opens often, don't refetch every open.
    if (providersRef.current && Date.now() - providersAtRef.current < 30000) return;
    providersLoadingRef.current = true;
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const raw = await g.modelOptions(sessionId ?? undefined, sessionId ? undefined : profile);
      const rows = Array.isArray(raw?.providers) ? raw.providers : [];
      if (rows.length > 0) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setProviders(
          rows.map((p: any) => ({
            slug: String(p?.slug ?? ''),
            name: String(p?.name ?? p?.slug ?? ''),
            ...(typeof p?.is_current === 'boolean' ? { isCurrent: p.is_current } : {}),
            models: Array.isArray(p?.models) ? p.models.map(String) : null,
            totalModels: Number(p?.total_models ?? (Array.isArray(p?.models) ? p.models.length : 0)),
            ...(typeof p?.authenticated === 'boolean' ? { authenticated: p.authenticated } : {}),
            ...(p?.capabilities && typeof p.capabilities === 'object' ? { capabilities: p.capabilities } : {}),
          })),
        );
        providersAtRef.current = Date.now();
        return;
      }
      throw new Error('empty provider list');
    } catch (eWs) {
      try {
        const next = await getModelOptions(host, cookie.current, { profile });
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setProviders(next);
        providersAtRef.current = Date.now();
      } catch (eRest) {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setProvidersError(errMsg(eRest) || errMsg(eWs));
        }
      }
    } finally {
      providersLoadingRef.current = false;
      setProvidersLoading(false);
    }
  }, [host, sessionId]);

  // ── Slash command catalog ──────────────────────────────────────────────
  // `commands.catalog` is the live authority for each command's `desktop=`
  // disposition (offered / terminal-only / picker-owned) and the alias map, so
  // the "/" wheel curates itself from the backend with no code change. Failure
  // is fine — ./slash-commands keeps the shipped registry as the cold fallback.

  const loadCommandsCatalog = useCallback(async () => {
    const g = gw.current;
    if (!g) return;
    // 60s TTL — sessionId effect fires often, catalog barely changes.
    if (Date.now() - catalogAtRef.current < 60000) return;
    try {
      rememberCommandsCatalog(await g.commandsCatalog(sessionId ?? undefined));
      catalogAtRef.current = Date.now();
      setCatalogVersion((v) => v + 1);
    } catch {
      // Older backend without commands.catalog — keep the static registry.
    }
  }, [sessionId]);

  // Session-scoped switch ("this chat") — /model WITHOUT --global.

  const pickModel = useCallback(
    async (providerSlug: string, modelId: string) => {
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      setModelProvider(providerSlug);
      setModel(modelId);
      void saveModel(providerSlug, modelId, profile);
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return; // applies to the next new session
      // The slash worker can take a while (cold start + provider probe).
      setToolLine('switching model…');
      try {
        await g.switchModel(sid, modelId, providerSlug || undefined);
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Model → ${providerSlug ? `${providerSlug}:` : ''}${modelId} (this chat)` }]);
      } catch (e: any) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        const code = e?.code !== undefined ? ` [${e.code}]` : '';
        const msg = errMsg(e);
        const hint = /timed?\s*out/i.test(msg) ? ' — try again, the worker is warm now' : '';
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Switch failed${code}: ${msg}${hint}` }]);
      } finally {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setToolLine(null);
        }
      }
    },
    [activeProfile, sessionId],
  );

  // Composer thinking-effort pick: applies to the LIVE session via `config.set`
  // (session-scoped, mirrors onto the running agent) and to the next new session
  // through createSession's reasoning_effort. Falling back to the slash worker
  // only reaches config.yaml, so it's the legacy path.
  const applyEffort = useCallback(
    async (level: string) => {
      const v = level.trim().toLowerCase();
      if (!v) return;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      setEffort(v);
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return; // no live session yet — used at the next create
      try {
        await g.configSet('reasoning', v, sid);
      } catch {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        try {
          await g.slashExec(sid, `/reasoning ${v}`);
        } catch (e2: any) {
          if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `reasoning: ${errMsg(e2)}` }]);
        }
      }
    },
    [activeProfile, sessionId],
  );

  // Fast mode (`/fast`) — session-scoped, same config.set path as reasoning.
  const applyFast = useCallback(
    async (on: boolean) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      if (!g || !sid) return;
      try {
        await g.configSet('fast', on ? 'fast' : 'normal', sid);
      } catch (e: any) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `fast: ${errMsg(e)}` }]);
      }
    },
    [activeProfile, sessionId],
  );

  // Persistent dangerous-command approval mode (manual | smart | off).
  const applyApprovalMode = useCallback(
    async (mode: 'manual' | 'smart' | 'off') => {
      const g = gw.current;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      if (!g) return;
      try {
        await g.configSet(
          'approvals.mode',
          mode,
          sessionId ?? undefined,
          undefined,
          sessionId ? undefined : profile,
        );
      } catch (e: any) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `approvals: ${errMsg(e)}` }]);
      }
    },
    [activeProfile, sessionId],
  );

  // Local notifications: request permission on enable (web needs the gesture).
  const setNotifications = useCallback(async (on: boolean) => {
    if (!on) {
      setNotifyEnabled(false);
      await saveNotifyEnabled(false);
      return;
    }
    const ok = await requestNotifyPermission();
    setNotifyEnabled(ok);
    await saveNotifyEnabled(ok);
  }, []);

  const connect = useCallback(
    async (h: string, user: string, pw: string) => {
      connectionEpochRef.current += 1;
      if (latest.current.host && latest.current.host !== h.trim()) {
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
      }
      setBusy(true);
      setError(null);
      try {
        const probe = await probeStatus(h);
        if (!probe.authRequired) {
          throw new Error('Dashboard has no auth gate (loopback?) — this app needs a gated dashboard with basic auth.');
        }
        if (!probe.providers.includes('basic')) {
          throw new Error(`Dashboard auth providers [${probe.providers.join(',')}] — basic not offered.`);
        }
        await ensureCookie(h, user, pw);
        const discovered = await discoverAgentProfiles(h, cookie.current);
        setProfiles(discovered.profiles);
        const preferred = activeProfilePreferenceRef.current;
        const selected =
          preferred && discovered.profiles.some((profile) => profile.name === preferred)
            ? preferred
            : discovered.current;
        activeProfilePreferenceRef.current = selected;
        activeProfileRef.current = selected;
        setActiveProfile(selected);
        void saveActiveProfile(selected);
        const selectedInfo = discovered.profiles.find((profile) => profile.name === selected);
        const rememberedModel = await getModel(selected).catch(() => null);
        setModel(String(rememberedModel?.model ?? selectedInfo?.model ?? ''));
        setModelProvider(String(rememberedModel?.provider ?? selectedInfo?.provider ?? ''));
        gw.current?.close();
        const ws = await openWs(h);
        gw.current = ws;
        const ok = await ws.connect();
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
        await saveHost(h, user);
        if (rememberPw && pw) await savePassword(pw);
        // Bounded waits — a wedged dashboard must never trap boot on a
        // spinner: list/open each get a ceiling, then we land on chat.
        let list: SessionSummary[] = [];
        try {
          list = await withTimeout(refreshSessions(), 30000);
        } catch {
          list = [];
        }
        setAuthed(true);
        if (list.length > 0) {
          // Restore the chat the user was last viewing, else the most recent.
          let target = list[0];
          try {
            const saved = await getLastSession(activeProfileRef.current);
            const found = saved ? list.find((s) => s.id === saved) : undefined;
            if (found) target = found;
          } catch {}
          try {
            await withTimeout(openSessionRef.current(target), 25000);
          } catch {
            router.replace('/chat');
          }
          return;
        }
        router.replace('/chat');
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [ensureCookie, openWs, rememberPw, refreshSessions],
  );
  connectRef.current = connect;

  const login = useCallback(async () => {
    const pw = password || (await getPassword()) || '';
    if (!host.trim() || !username.trim() || !pw) {
      setError('Fill host, username and password');
      return;
    }
    await connect(host.trim(), username.trim(), pw);
  }, [host, username, password, connect]);

  const logout = useCallback(async () => {
    connectionEpochRef.current += 1;
    gw.current?.close();
    gw.current?.clearAskRecords();
    gw.current = null;
    cookie.current = '';
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
    await clearCookie();
    setAuthed(false);
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
  }, [sessionKey]);

  // ── Sessions ─────────────────────────────────────────────────────────────

  const openSession = useCallback(async (s: ScopedSessionSummary) => {
    const g = gw.current;
    if (!g) {
      setError('Not connected — please login again');
      return;
    }
    const connectionEpoch = connectionEpochRef.current;
    const profile = normalizeProfileName(s.profile ?? activeProfileRef.current);
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
      if (!isLatestOpen() || !isSameConnection() || activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      const resumeInfo =
        r?.info && typeof r.info === 'object' && !Array.isArray(r.info) ? r.info : null;
      // Resume carries the session's todo snapshot; restore the checklist.
      setTodos(normalizeTodos(r?.todo_state));
      // Full transcript via REST first (tool RESULT content + reasoning) —
      // WS session.history is only a compact projection. Stored id, not live.
      let hist: HistoryMessage[];
      try {
        // Gate on the cookie ONLY as a fallback signal: on web the jar is empty
        // (JS can't read Set-Cookie) while the browser cookie still authenticates
        // via `credentials: 'include'`, so always try REST.
        hist = await getSessionMessages(host, cookie.current, s.id, profile);
      } catch {
        hist = [];
      }
      if (hist.length === 0) hist = await g.history(liveId);
      if (!isLatestOpen() || !isSameConnection() || activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      const owner = profileSessionKey(profile, s.id);
      runtimeOwners.current.set(liveId, owner);
      bindAskOwner(liveId, {
        connectionId: latest.current.host,
        profile,
        storedSessionId: s.id,
        runtimeSessionId: liveId,
        resolved: true,
      });
      setSessionKey(s.id);
      void saveLastSession(s.id, profile);
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
        r?.running === true ||
        r?.status === 'working' ||
        (r?.inflight != null && typeof r.inflight === 'object');
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
      if (!isLatestOpen() || !isSameConnection() || activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
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
  }, [host, hydrateSessionContext, bindAskOwner]);
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
      if (!isLatestOpen() || !isSameConnection() || activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      const owner = profileSessionKey(profile, storedSessionId || sid);
      runtimeOwners.current.set(sid, owner);
      bindAskOwner(sid, {
        connectionId: latest.current.host,
        profile,
        storedSessionId: storedSessionId || sid,
        runtimeSessionId: sid,
        resolved: true,
      });
      setSessionKey(storedSessionId || sid);
      void saveLastSession(storedSessionId || sid, profile);
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
      if (isLatestOpen() && isSameConnection() && activeProfileRef.current === profile && profileEpochRef.current === epoch) {
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
      if (isLatestOpen() && isSameConnection() && activeProfileRef.current === profile && profileEpochRef.current === epoch) {
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
      activeProfilePreferenceRef.current = next;
      activeProfileRef.current = next;
      setActiveProfile(next);
      void saveActiveProfile(next);

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
      const remembered = await getModel(next).catch(() => null);
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
    [inputRaw, parkLiveTurn, clearStreaming, profiles, refreshProfiles, refreshSessions],
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
      if (connectionEpochRef.current !== connectionEpoch || activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
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
        connectionId: latest.current.host,
        profile,
        storedSessionId: branchKey,
        runtimeSessionId: liveId,
        resolved: true,
      });
      setSessionKey(branchKey);
      void saveLastSession(branchKey, profile);
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
      const branchInfo =
        r?.info && typeof r.info === 'object' && !Array.isArray(r.info) ? r.info : null;
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
      if (connectionEpochRef.current === connectionEpoch && activeProfileRef.current === profile && profileEpochRef.current === epoch) {
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
    async (submitText: string, echo?: { text: string; media?: Attachment[] }, rewindRowId?: number, confirmEmptyTruncate?: boolean) => {
      const g = gw.current;
      const sid = sessionId;
      const profile = activeProfile;
      const epoch = profileEpochRef.current;
      const connectionEpoch = connectionEpochRef.current;
      if (!g || !sid) return;
      const submitOpts = rewindRowId != null ? { rewindRowId, ...(confirmEmptyTruncate ? { confirmEmptyTruncate: true } : {}) } : {};
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
        connectionId: latest.current.host,
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
          { id: nid(), role: 'user' as Role, text: submitText, ts: Math.floor(Date.now() / 1000) },
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
              connectionId: latest.current.host,
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
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Session busy (${msg}). Stop the live turn and resend.` }]);
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

  // ── Prompt queue ─────────────────────────────────────────────────────────
  // Prompts typed while a turn is running are held here (client-side) and drained
  // one per turn end — see drainRef / onComplete. An explicit Stop parks the
  // queue until the user queues again or taps Resume (desktop parity).
  //
  // The ref is authoritative (mutated synchronously) and state mirrors it: two
  // drains firing before a re-render must not both pick up the same head.
  const setQueue = useCallback((update: (prev: QueuedPrompt[]) => QueuedPrompt[]) => {
    queuedRef.current = update(queuedRef.current);
    setQueued(queuedRef.current);
  }, []);

  const enqueueQueued = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      queueParkedRef.current = false;
      setQueueParked(false); // queueing lifts a park
      setQueue((prev) => [...prev, { id: nid(), text: t }]);
      // Idle (parked/unparked) → start immediately; mid-turn → waits for onComplete.
      queueMicrotask(() => drainRef.current());
    },
    [setQueue],
  );
  const removeQueued = useCallback((id: string) => setQueue((prev) => prev.filter((q) => q.id !== id)), [setQueue]);
  const clearQueue = useCallback(() => {
    setQueue(() => []);
    queueParkedRef.current = false;
    setQueueParked(false);
  }, [setQueue]);
  const resumeQueue = useCallback(() => {
    queueParkedRef.current = false;
    setQueueParked(false);
    queueMicrotask(() => drainRef.current());
  }, []);
  const sendQueuedNow = useCallback(
    (id: string) => {
      queueParkedRef.current = false;
      setQueueParked(false);
      if (generatingRef.current) {
        // Busy — move it to the front; the drain picks it up at turn end.
        setQueue((prev) => {
          const item = prev.find((q) => q.id === id);
          return item ? [item, ...prev.filter((q) => q.id !== id)] : prev;
        });
        return;
      }
      const item = queuedRef.current.find((q) => q.id === id);
      if (!item) return;
      setQueue((prev) => prev.filter((q) => q.id !== id));
      void sendRef.current?.(item.text);
    },
    [setQueue],
  );
  // Fresh closure each render so the once-created onComplete handler always
  // drains against current queue/generating state.
  drainRef.current = () => {
    if (queueParkedRef.current || generatingRef.current || queueDrainInFlightRef.current) return;
    const next = queuedRef.current[0];
    if (!next) return;
    queueDrainInFlightRef.current = true;
    let submitted = false;
    void Promise.resolve(sendRef.current?.(next.text))
      .then(() => {
        submitted = true;
      })
      .catch(() => {})
      .finally(() => {
        if (submitted) setQueue((prev) => prev.filter((q) => q.id !== next.id));
        queueDrainInFlightRef.current = false;
        if (submitted && !queueParkedRef.current && !generatingRef.current) drainRef.current();
      });
  };

  // ── Edit / regenerate (rewind) ────────────────────────────────────────────
  // "Edit & resend" rewinds history to that user row and resubmits the edited
  // text; "Regenerate" reruns the last user turn. Both need the durable row id
  // (ordinal-only cuts are refused for durable sessions).
  const editRowRef = useRef<number | null>(null);
  const [editingRowId, setEditingRowId] = useState<number | null>(null);

  const editMessage = useCallback(
    (id: string) => {
      const m = messagesRef.current.find((x) => x.id === id);
      if (!m || m.role !== 'user') return;
      if (m.rowId == null) {
        stampRowIdsRef.current();
        setMessages((prev) => [
          ...prev,
          { id: nid(), role: 'notice', text: 'Loading the message id — tap Edit again in a moment.' },
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
    const lastUser = [...list]
      .reverse()
      .find((m) => m.role === 'user' && m.rowId != null && m.text.trim());
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

  const send = useCallback(async (override?: string) => {
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
    const submitText = [
      ...sent.map((s) => `[attached ${s.image ? 'image' : 'file'}: ${s.path}]`),
      text,
    ]
      .filter(Boolean)
      .join('\n');
    // Editing the first turn rewrites the whole transcript — same server gate
    // as regenerate (confirm_empty_truncate).
    const rewindTarget =
      rewindRowId != null
        ? messagesRef.current.find(
            (m) => m.rowId === rewindRowId && (m.role === 'user' || m.role === 'assistant'),
          )
        : undefined;
    await beginTurn(
      submitText,
      { text: shownText, media: images },
      rewindRowId,
      rewindTarget ? cutsWholeTranscript(messagesRef.current, rewindTarget.id) : false,
    );
  }, [activeProfile, input, attachments, sessionId, setInput, setAttachments, beginTurn, runSlash, enqueueQueued]);
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
      if (
        activeProfileRef.current === profile &&
        profileEpochRef.current === epoch &&
        sessionIdRef.current === sid
      ) {
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
            ? runtimeOwners.current.get(runtime) ?? profileSessionKey(latest.current.activeProfile, runtime)
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
          { id: nid(), role: 'notice', text: 'No updates for a while — released the stop button. The reply will still land if the agent is working.' },
        ]);
      })();
    }, 10000);
    return () => clearInterval(t);
  }, [generating, sessionId, sessionKey, releaseLocalTurn, probeWorkingSessions]);
  stopRef.current = stop;

  // ── Session details ────────────────────────────────────────────────────

  const openInfo = useCallback(async () => {
    setInfoOpen(true);
    setInfoSeq((s) => s + 1);
    const g = gw.current;
    const sid = sessionId;
    const profile = activeProfile;
    const epoch = profileEpochRef.current;
    if (!g || !sid) return;
    setUsageLoading(true);
    try {
      const info = await g.usage(sid);
      if (sessionIdRef.current === sid) setUsageInfo((prev: any) => mergeUsageState(prev, info));
    } catch (e) {
      if (sessionIdRef.current === sid) setUsageInfo({ error: errMsg(e) });
    } finally {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
        setUsageLoading(false);
      }
    }
  }, [activeProfile, sessionId]);

  // ── Ask replies ──────────────────────────────────────────────────────────

  const respondToInbox = useCallback(
    (key: string, result: Record<string, unknown>) => {
      const entry = findAsk(askInboxRef.current, key);
      const g = gw.current;
      if (!entry || !g || entry.owner.connectionId !== latest.current.host) return false;
      if (entry.status !== 'pending' && entry.status !== 'answering') return false;
      if (!g.replyToAsk(entry.rpcId, result)) return false;
      markAskStatus(entry.key, 'sent');
      // JSON-RPC has no positive acknowledgement. Give the gateway a moment
      // to settle the request, then reconcile against open_requests.
      if (entry.sessionId) {
        setTimeout(() => {
          if (gw.current === g) void g.syncOpenRequests([entry.sessionId as string]);
        }, 500);
      }
      return true;
    },
    [markAskStatus],
  );

  const answerInboxValue = useCallback(
    (key: string, value: string) => respondToInbox(key, { value }),
    [respondToInbox],
  );

  const answerInboxApproval = useCallback(
    (key: string, choice: string) => respondToInbox(key, { choice }),
    [respondToInbox],
  );

  const openAskEntry = useCallback(async (entry: AskInboxEntry) => {
    if (!entry) return;
    if (entry.status === 'sent') {
      setError('This response was sent but not confirmed yet. Reconnect or refresh Ask Inbox.');
      return;
    }
    if (entry.status !== 'pending' && entry.status !== 'answering') return;
    if (!entry.owner.resolved || !entry.owner.storedSessionId) {
      setError('This background request has no resolved profile yet. Open its session to answer it safely.');
      router.push('/asks');
      return;
    }
    if (entry.owner.profile !== activeProfileRef.current) {
      setError(`Switch to profile “${entry.owner.profile}” before answering this request.`);
      return;
    }
    try {
      await openSessionRef.current({
        id: entry.owner.storedSessionId,
        title: '',
        preview: '',
        messageCount: 0,
        source: 'ask-inbox',
        startedAt: Date.now() / 1000,
        profile: entry.owner.profile,
      });
      // openSession may have restored a fresh runtime id; show the same
      // pending request only after the target room is actually active.
      const activeOwner = sessionIdRef.current
        ? parseProfileSessionKey(runtimeOwners.current.get(sessionIdRef.current) ?? '')
        : null;
      if (
        activeOwner?.profile !== entry.owner.profile ||
        activeOwner?.storedSessionId !== entry.owner.storedSessionId
      ) {
        setError('Could not open the owning session; the request remains in Ask Inbox.');
        return;
      }
      const refreshed = findAskByRpc(askInboxRef.current, latest.current.host, entry.rpcId) ?? entry;
      setAsk(serverAskFromInbox(refreshed));
      router.push('/chat');
    } catch (e) {
      setError(errMsg(e));
    }
  }, []);

  const answerAsk = useCallback(
    (result: Record<string, unknown>) => {
      const current = askRef.current;
      if (!current || !gw.current) return false;
      const entry = askInboxRef.current.find(
        (item) => item.owner.connectionId === latest.current.host && item.rpcId === current.rpcId,
      );
      return entry ? respondToInbox(entry.key, result) : false;
    },
    [respondToInbox],
  );

  const answerValue = useCallback(
    (value: string) => {
      answerAsk({ value });
    },
    [answerAsk],
  );

  const answerApproval = useCallback(
    (choice: string) => answerAsk({ choice }),
    [answerAsk],
  );

  const dismissAsk = useCallback(() => setAsk(null), []);

  const confirmSensitiveNotification = useCallback(async (): Promise<boolean> => {
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuth.hasHardwareAsync(),
        LocalAuth.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) return false;
      const result = await LocalAuth.authenticateAsync({ promptMessage: 'Confirm Hermes request' });
      return result.success === true;
    } catch {
      return false;
    }
  }, []);

  const handleNotificationResponse = useCallback(
    (response: HermesNotificationResponse) => {
      const data = response.data;
      const responseKey = notificationResponseKey(response);
      if (handledNotificationResponsesRef.current.has(responseKey)) return;
      if (
        typeof data.connectionId === 'string' &&
        latest.current.host &&
        data.connectionId !== latest.current.host
      ) {
        return;
      }
      if (!latest.current.host || !gw.current || askHydrationRef.current > 0) {
        queueNotificationResponse(response);
        return;
      }
      const key = typeof data.askKey === 'string' ? data.askKey : '';
      const rpcId = typeof data.rpcId === 'string' ? data.rpcId : '';
      const entry =
        (key ? findAsk(askInboxRef.current, key) : undefined) ??
        (rpcId ? findAskByRpc(askInboxRef.current, latest.current.host, rpcId) : undefined);
      if (!entry) {
        if (!key && !rpcId) {
          if (response.actionIdentifier === NOTIFICATION_DEFAULT_ACTION) {
            handledNotificationResponsesRef.current.add(responseKey);
            router.push('/chat');
          }
          return;
        }
        queueNotificationResponse(response);
        router.push('/asks');
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_APPROVE) {
        const choices = Array.isArray(entry.params.choices) ? entry.params.choices.map(String) : [];
        if (!choices.includes('once')) {
          handledNotificationResponsesRef.current.add(responseKey);
          void openAskEntry(entry);
          return;
        }
        if (notificationActionInFlightRef.current) return;
        notificationActionInFlightRef.current = true;
        void (async () => {
          try {
            if (!(await confirmSensitiveNotification())) {
              handledNotificationResponsesRef.current.add(responseKey);
              router.push('/asks');
              return;
            }
            const current = findAskByRpc(askInboxRef.current, latest.current.host, entry.rpcId);
            if (!current) {
              queueNotificationResponse(response);
              return;
            }
            if (answerInboxApproval(current.key, 'once')) {
              handledNotificationResponsesRef.current.add(responseKey);
            } else {
              queueNotificationResponse(response);
              router.push('/asks');
            }
          } finally {
            notificationActionInFlightRef.current = false;
            const queued = pendingNotificationResponsesRef.current.find(
              (item) => notificationResponseKey(item) === responseKey,
            );
            if (handledNotificationResponsesRef.current.has(responseKey)) {
              if (queued) clearQueuedNotificationResponse(queued);
            } else if (pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) !== responseKey)) {
              notificationDrainRef.current?.();
            }
          }
        })();
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_REJECT) {
        const choices = Array.isArray(entry.params.choices) ? entry.params.choices.map(String) : [];
        if (choices.length > 0 && !choices.includes('deny')) {
          handledNotificationResponsesRef.current.add(responseKey);
          void openAskEntry(entry);
          return;
        }
        if (notificationActionInFlightRef.current) return;
        notificationActionInFlightRef.current = true;
        void (async () => {
          try {
            if (!(await confirmSensitiveNotification())) {
              handledNotificationResponsesRef.current.add(responseKey);
              router.push('/asks');
              return;
            }
            const current = findAskByRpc(askInboxRef.current, latest.current.host, entry.rpcId);
            if (!current) {
              queueNotificationResponse(response);
              return;
            }
            if (answerInboxApproval(current.key, 'deny')) {
              handledNotificationResponsesRef.current.add(responseKey);
            } else {
              queueNotificationResponse(response);
              router.push('/asks');
            }
          } finally {
            notificationActionInFlightRef.current = false;
            const queued = pendingNotificationResponsesRef.current.find(
              (item) => notificationResponseKey(item) === responseKey,
            );
            if (handledNotificationResponsesRef.current.has(responseKey)) {
              if (queued) clearQueuedNotificationResponse(queued);
            } else if (pendingNotificationResponsesRef.current.some((item) => notificationResponseKey(item) !== responseKey)) {
              notificationDrainRef.current?.();
            }
          }
        })();
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_ANSWER) {
        const text = String(response.userText ?? '').trim();
        if (!text) {
          handledNotificationResponsesRef.current.add(responseKey);
          void openAskEntry(entry);
          return;
        }
        if (entry.method === 'clarify') {
          if (Array.isArray(entry.params.questions) && entry.params.questions.length > 0) {
            handledNotificationResponsesRef.current.add(responseKey);
            void openAskEntry(entry);
            return;
          }
          if (respondToInbox(entry.key, { answer: text })) {
            handledNotificationResponsesRef.current.add(responseKey);
          } else {
            queueNotificationResponse(response);
            router.push('/asks');
          }
        } else if (answerInboxValue(entry.key, text)) {
          handledNotificationResponsesRef.current.add(responseKey);
        } else {
          queueNotificationResponse(response);
          router.push('/asks');
        }
        return;
      }

      if (response.actionIdentifier === NOTIFICATION_ASK_OPEN) {
        handledNotificationResponsesRef.current.add(responseKey);
        void openAskEntry(entry);
        return;
      }
      if (response.actionIdentifier === NOTIFICATION_DEFAULT_ACTION) {
        handledNotificationResponsesRef.current.add(responseKey);
        router.push('/asks');
      }
    },
    [answerInboxApproval, answerInboxValue, confirmSensitiveNotification, openAskEntry, respondToInbox],
  );

  const drainPendingNotificationResponse = useCallback(() => {
    if (notificationActionInFlightRef.current) return;
    const pending = pendingNotificationResponsesRef.current[0];
    if (!pending) return;
    pendingNotificationResponsesRef.current = pendingNotificationResponsesRef.current.slice(1);
    void handleNotificationResponse(pending);
  }, [handleNotificationResponse]);
  notificationDrainRef.current = drainPendingNotificationResponse;
  useEffect(() => {
    drainPendingNotificationResponse();
    return () => {
      if (notificationDrainRef.current === drainPendingNotificationResponse) {
        notificationDrainRef.current = null;
      }
    };
  }, [drainPendingNotificationResponse]);

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

  const closeCurrent = useCallback(async () => {
    const g = gw.current;
    if (!g || !sessionId) return;
    await g.closeSession(sessionId);
    const owner = runtimeOwners.current.get(sessionId);
    runtimeOwners.current.delete(sessionId);
    runtimeAskOwners.current.delete(sessionId);
    if (owner) {
      parkedLiveRef.current.delete(owner);
      turnOwnerRef.current.delete(sessionId);
      const parsed = parseProfileSessionKey(owner);
      if (parsed) {
        const nextAskInbox = askInboxRef.current.map((entry) =>
          entry.owner.profile === parsed.profile && entry.owner.storedSessionId === parsed.storedSessionId
            ? { ...entry, status: 'stale' as const }
            : entry,
        );
        askInboxRef.current = nextAskInbox;
        setAskInbox(nextAskInbox);
      }
    }
    setAsk(null);
  }, [sessionId]);

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
            { id: nid(), role: 'notice', text: '↪ too late to steer this turn — queued as the next message' },
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
              connectionId: latest.current.host,
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
            setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Steer failed: ${errMsg(e2)}` }]);
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
      setModelProvider(providerSlug);
      setModel(modelId);
      void saveModel(providerSlug, modelId, profile);
      if (!host) return;
      setToolLine('setting global default…');
      try {
        await setMainModel(host, cookie.current, providerSlug, modelId, profile);
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [
          ...prev,
          { id: nid(), role: 'notice', text: `Global default → ${providerSlug ? `${providerSlug}:` : ''}${modelId}` },
        ]);
      } catch (e) {
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Global set failed: ${errMsg(e)}` }]);
      } finally {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setToolLine(null);
        }
      }
    },
    [activeProfile, host],
  );

  const jumpToRecent = useCallback(async () => {
    const g = gw.current;
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    if (!g) return;
    setBusy(true);
    try {
      const recentId = await g.mostRecent(profile);
      if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      if (!recentId) {
        await refreshSessions();
        return;
      }
      const known = sessions.find((s) => s.id === recentId);
      if (known) {
        await openSession(known);
        return;
      }
      await refreshSessions();
      // List may use a different id space — resume directly as fallback.
      try {
        const r: any = await g.call('session.resume', {
          profile,
          session_id: recentId,
          omit_messages: false,
        });
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
        const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : recentId;
        const owner = profileSessionKey(profile, recentId);
        runtimeOwners.current.set(liveId, owner);
        bindAskOwner(liveId, {
          connectionId: latest.current.host,
          profile,
          storedSessionId: recentId,
          runtimeSessionId: liveId,
          resolved: true,
        });
        parkLiveTurn();
        liveAid.current = null;
        liveThinkAid.current = null;
        setGenerating(false);
        generatingRef.current = false;
        setToolLine(null);
        setSessionKey(recentId);
        draftKeyRef.current = owner;
        setInputRaw(draftsRef.current.get(owner) ?? '');
        sessionIdRef.current = liveId;
        setSessionId(liveId);
        setSessionTitle('');
        setMessages([]);
        clearStreaming();
        router.push('/chat');
      } catch (e) {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setError(errMsg(e));
        }
      }
    } finally {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
        setBusy(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, refreshSessions]);

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

  const opsGet = useCallback(async (path: string) => dashboardOpsGet(host, cookie.current, path), [host]);
  const opsMut = useCallback(
    async (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) =>
      dashboardOpsMut(host, cookie.current, path, method, body),
    [host],
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
    setEffort,
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
    answerInboxValue,
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
    toggleTheme,
    renameSession,
    deleteSessionById,
    closeCurrent,
    redirectLive,
    setGlobalModel,
    jumpToRecent,
    opsGet,
    opsMut,
    getGw,
    diagnostics,
    getCookie,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [booting, authed, busy, error, host, username, password, conn, activeProfile, profiles, refreshProfiles, switchProfile, sessions, openingId, sessionId, sessionKey, sessionTitle, messages, streamingTexts, input, setInput, model, modelProvider, effort, applyEffort, applyFast, providers, providersLoading, providersError, attachments, generating, copiedId, infoOpen, infoSeq, sessionInfo, usageInfo, usageLoading, toolLine, ask, askInbox, openAskEntry, answerInboxValue, answerInboxApproval, connect, login, logout, refreshSessions, loadMoreSessions, sessionsHasMore, sessionsLoadingMore, openSession, newSession, send, stop, openInfo, loadProviders, loadCommandsCatalog, queued, queueParked, enqueueQueued, removeQueued, clearQueue, resumeQueue, sendQueuedNow, editingRowId, editMessage, cancelEdit, regenerate, pasteLarge, applyApprovalMode, branchSession, notifyEnabled, setNotifications, todos, subagents, refreshToolResults, pickModel, copyText, answerValue, answerApproval, answerAsk, dismissAsk, theme, themeMode, setTheme, toggleTheme, renameSession, deleteSessionById, closeCurrent, redirectLive, setGlobalModel, jumpToRecent, opsGet, opsMut, getGw, diagnostics, getCookie],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
