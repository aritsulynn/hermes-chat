// Global app state — the full logic of the old monolithic AppInner
// (App.tsx), lifted into a context provider so the expo-router screens
// (login / sessions / chat) share one connection, one gateway socket and
// one transcript. Navigation replaced setScreen() with expo-router routes.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
import { clearCookie, getCookie, getPassword, getTheme, loadConnection, saveCookie, saveHost, savePassword, saveTheme } from '../lib/connection';
import type { Theme } from '../lib/connection';
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
  sessions: SessionSummary[];
  openingId: string | null;
  sessionId: string | null;
  sessionTitle: string;
  messages: UiMessage[];
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
  connect: (h: string, user: string, pw: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refreshSessions: () => Promise<SessionSummary[]>;
  openSession: (s: SessionSummary) => Promise<void>;
  newSession: () => Promise<void>;
  send: () => Promise<void>;
  stop: () => void;
  openInfo: () => Promise<void>;
  getGw: () => GatewayWs | null;
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
  /** Agent's live todo list (`todo.updated`), for the checklist above the composer. */
  todos: TodoItem[];
  /** Live child agents (polled from `subagent.list` while a turn runs). */
  subagents: SubagentRow[];
  /** Re-fetch tool results from the REST transcript (fills expanded tool bubbles). */
  refreshToolResults: () => void;
  pickModel: (providerSlug: string, modelId: string) => Promise<void>;
  copyText: (id: string, text: string) => Promise<void>;
  answerValue: (value: string) => void;
  answerApproval: (choice: string) => void;
  dismissAsk: () => void;
  theme: Theme;
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
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);
}

// ── Attachment upload ───────────────────────────────────────────────────────
// prompt.submit is text-only, so bytes ride the dashboard files API (the same
// route the Files tab uses) and the agent is handed a path it can open.

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
  host: string,
  cookie: string,
): Promise<{ name: string; path: string; image: boolean }[]> {
  const out: { name: string; path: string; image: boolean }[] = [];
  for (const f of files) {
    const name = f.name.replace(/[\\/]/g, '_') || `upload-${Date.now()}`;
    const image = isImageAttachment(f);
    const b64 = await attachmentBytes(f);
    if (!b64) throw new Error(`${name}: could not read the file`);
    if (b64.length > MAX_UPLOAD_BYTES * 1.4) throw new Error(`${name}: too large (10 MB max)`);
    const data_url = `data:${f.mime || 'application/octet-stream'};base64,${b64}`;
    const put = (path: string) =>
      dashboardOpsMut(host, cookie, '/api/files/upload', 'POST', { path, data_url, overwrite: true });
    try {
      const r: any = await put(`~/${name}`);
      out.push({ name, path: typeof r?.path === 'string' && r.path ? r.path : `~/${name}`, image });
    } catch (first) {
      // Some builds reject the `~` shorthand for writes — resolve the managed
      // root and retry once before giving up.
      const home: any = await dashboardOpsGet(host, cookie, '/api/files?path=~').catch(() => null);
      const root = typeof home?.path === 'string' ? home.path.replace(/\/+$/, '') : '';
      if (!root) throw first;
      const target = `${root}/${name}`;
      const r: any = await put(target);
      out.push({ name, path: typeof r?.path === 'string' && r.path ? r.path : target, image });
    }
  }
  return out;
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
  const [host, setHost] = useState('http://192.168.1.8:9119');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conn, setConn] = useState<ConnState>('idle');
  const [authed, setAuthed] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null); // stored DB id — stable across resumes
  const [sessionTitle, setSessionTitle] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
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
  const [theme, setThemeState] = useState<Theme>('light');
  const { setColorScheme } = useNWColorScheme();

  const setTheme = useCallback(
    (t: Theme) => {
      setThemeState(t);
      try {
        setColorScheme(t);
      } catch {}
      void saveTheme(t);
    },
    [setColorScheme],
  );
  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const gw = useRef<GatewayWs | null>(null);
  const cookie = useRef<string>('');
  const uploading = useRef(false); // send() re-entrancy guard while bytes go up
  const liveAid = useRef<string | null>(null);
  const liveThinkAid = useRef<string | null>(null);
  const liveTools = useRef<Map<string, string>>(new Map());
  const liveToolAid = useRef<string | null>(null);
  const liveTurnTools = useRef<string[]>([]); // tool bubbles minted this turn, in order
  const liveTurnDiffs = useRef<string[]>([]); // inline diffs seen this turn (for the end-of-turn summary)
  // Live runtime session id for callbacks frozen in openWs (reconnect replay).
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current = sessionId;
  // Queue plumbing reads the freshest values from inside the once-created WS
  // event handlers (onComplete drains the queue before React re-renders).
  const generatingRef = useRef(false);
  const queueParkedRef = useRef(false);
  const queuedRef = useRef<QueuedPrompt[]>([]);
  const sendRef = useRef<((text?: string) => Promise<void>) | null>(null);
  const drainRef = useRef<() => void>(() => {});
  // Live transcript, for handlers frozen in openWs (tool backfill name-checking).
  const messagesRef = useRef<UiMessage[]>([]);
  generatingRef.current = generating;
  queueParkedRef.current = queueParked;
  queuedRef.current = queued;
  messagesRef.current = messages;
  // Latest host/sessionKey for callbacks frozen in openWs (created once).
  const latest = useRef({ host, sessionKey });
  latest.current = { host, sessionKey };
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
    const sk = latest.current.sessionKey;
    const ck = cookie.current;
    // Web: the jar is empty (Set-Cookie is unreadable) but the browser cookie
    // still rides along via credentials:'include', so only host+key are required.
    if (!h || !sk) return;
    void (async () => {
      try {
        const items = await getSessionMessages(h, ck, sk);
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
    const sk = latest.current.sessionKey;
    if (!h || !sk) return;
    void (async () => {
      try {
        const items = await getSessionMessages(h, cookie.current, sk);
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
    const sk = latest.current.sessionKey;
    if (!h || !sk) return;
    void (async () => {
      try {
        const hist = await getSessionMessages(h, cookie.current, sk);
        if (hist.length) {
          setMessages(historyToItems(hist));
          setToolLine(null);
        }
      } catch {}
    })();
  };
  // Refresh the composer status strip at each turn end (session.info isn't
  // guaranteed to carry usage every turn); session.usage answers the live numbers.
  const usageRefreshRef = useRef<() => void>(() => {});
  usageRefreshRef.current = () => {
    const g = gw.current;
    const sid = sessionId;
    if (!g || !sid) return;
    void g.usage(sid).then(setUsageInfo).catch(() => {});
  };
  // Live subagent roster — polled while a turn runs (subagent.list is scoped to
  // this session). Cheap: the RPC returns a small snapshot.
  useEffect(() => {
    const g = gw.current;
    if (!generating || !sessionId || !g) return;
    let live = true;
    const tick = () => {
      g.subagents(sessionId)
        .then((r) => {
          if (live) setSubagents(normalizeSubagents(r));
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
    draftKeyRef.current = sessionKey ?? sessionId ?? '__none__';
  }, [sessionKey, sessionId]);
  const setInput = useCallback((v: string) => {
    draftsRef.current.set(draftKeyRef.current, v);
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
        // Restore theme before first paint if possible.
        const savedTheme = await getTheme().catch(() => null);
        if (cancelled) return;
        if (savedTheme) {
          setThemeState(savedTheme);
          try {
            setColorScheme(savedTheme);
          } catch {}
        }
        // Silent reconnect — restore the session without asking login again.
        // Hard ceiling: even a totally wedged connect must release the boot
        // gate so the user gets the login form instead of a dead spinner.
        if (c.hasCookie && c.username) {
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

  const openWs = useCallback(async (h: string): Promise<GatewayWs> => {
    const ticket = await mintWsTicket(h, cookie.current);
    const ws = new GatewayWs({
      wsUrl: toWsUrl(h, ticket),
      refreshUrl: async () => {
        const t = await mintWsTicket(h, cookie.current);
        return toWsUrl(h, t);
      },
      // Replay missed events only for the session the app is showing.
      replaySessions: () => (sessionIdRef.current ? [sessionIdRef.current] : []),
      events: {
        onState: (s) => setConn(s),
        onToken: (_sid, delta) => {
          const aid = liveAid.current;
          if (!aid) return;
          setMessages((prev) => prev.map((m) => (m.id === aid ? { ...m, text: m.text + delta } : m)));
        },
        onReasoning: (_sid, delta) => {
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
          }
          const id = aid;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)));
        },
        onInterim: (_sid, text) => {
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
        onTool: (_sid, info) => {
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
        onComplete: (_sid, text) => {
          const aid = liveAid.current;
          liveAid.current = null;
          liveThinkAid.current = null;
          liveTurnTools.current = [];
          setGenerating(false);
          // onComplete runs before React re-renders, so flip the ref too or the
          // drain below would see a stale "generating" and bail.
          generatingRef.current = false;
          setToolLine(null);
          if (aid) {
            setMessages((prev) =>
              prev.map((m) => (m.id === aid ? { ...m, text: text || m.text, pending: false } : m)),
            );
          } else if (text) {
            setMessages((prev) => [...prev, { id: nid(), role: 'assistant', text }]);
          }
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
        },
        onNotice: (_sid, text) => {
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text }]);
        },
        onSessionInfo: (info) => setSessionInfo(info),
        onTodo: (_sid, payload) => setTodos(normalizeTodos(payload)),
        onReplayTruncated: (sid) => {
          // Only the session on screen shares our transcript state.
          if (sid === sessionIdRef.current) resyncRef.current();
        },
        onAsk: (a) => setAsk(a),
        onAskCancel: (rpcId) => {
          setAsk((cur) => (cur?.rpcId === rpcId ? null : cur));
        },
      },
    });
    return ws;
  }, []);

  const refreshSessions = useCallback(async (): Promise<SessionSummary[]> => {
    const g = gw.current;
    if (!g) return [];
    try {
      const s = await g.listSessions(100);
      setSessions(s);
      return s;
    } catch (e) {
      setError(errMsg(e));
      return [];
    }
  }, []);

  // ── Model picker inventory ─────────────────────────────────────────────
  // WS model.options first (same payload as REST), cookie REST as fallback.

  const loadProviders = useCallback(async () => {
    const g = gw.current;
    if (!g) return;
    setProvidersLoading(true);
    setProvidersError(null);
    try {
      const raw = await g.modelOptions(sessionId ?? undefined);
      const rows = Array.isArray(raw?.providers) ? raw.providers : [];
      if (rows.length > 0) {
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
        return;
      }
      throw new Error('empty provider list');
    } catch (eWs) {
      try {
        setProviders(await getModelOptions(host, cookie.current));
      } catch (eRest) {
        setProvidersError(errMsg(eRest) || errMsg(eWs));
      }
    } finally {
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
    try {
      rememberCommandsCatalog(await g.commandsCatalog(sessionId ?? undefined));
      setCatalogVersion((v) => v + 1);
    } catch {
      // Older backend without commands.catalog — keep the static registry.
    }
  }, [sessionId]);

  // Session-scoped switch ("this chat") — /model WITHOUT --global.

  const pickModel = useCallback(
    async (providerSlug: string, modelId: string) => {
      setModelProvider(providerSlug);
      setModel(modelId);
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return; // applies to the next new session
      // The slash worker can take a while (cold start + provider probe).
      setToolLine('switching model…');
      try {
        await g.switchModel(sid, modelId, providerSlug || undefined);
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Model → ${providerSlug ? `${providerSlug}:` : ''}${modelId} (this chat)` }]);
      } catch (e: any) {
        const code = e?.code !== undefined ? ` [${e.code}]` : '';
        const msg = errMsg(e);
        const hint = /timed?\s*out/i.test(msg) ? ' — try again, the worker is warm now' : '';
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Switch failed${code}: ${msg}${hint}` }]);
      } finally {
        setToolLine(null);
      }
    },
    [sessionId],
  );

  // Composer thinking-effort pick: applies to the LIVE session via `config.set`
  // (session-scoped, mirrors onto the running agent) and to the next new session
  // through createSession's reasoning_effort. Falling back to the slash worker
  // only reaches config.yaml, so it's the legacy path.
  const applyEffort = useCallback(
    async (level: string) => {
      const v = level.trim().toLowerCase();
      if (!v) return;
      setEffort(v);
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return; // no live session yet — used at the next create
      try {
        await g.configSet('reasoning', v, sid);
      } catch {
        try {
          await g.slashExec(sid, `/reasoning ${v}`);
        } catch (e2: any) {
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `reasoning: ${errMsg(e2)}` }]);
        }
      }
    },
    [sessionId],
  );

  // Fast mode (`/fast`) — session-scoped, same config.set path as reasoning.
  const applyFast = useCallback(
    async (on: boolean) => {
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return;
      try {
        await g.configSet('fast', on ? 'fast' : 'normal', sid);
      } catch (e: any) {
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `fast: ${errMsg(e)}` }]);
      }
    },
    [sessionId],
  );

  // Persistent dangerous-command approval mode (manual | smart | off).
  const applyApprovalMode = useCallback(
    async (mode: 'manual' | 'smart' | 'off') => {
      const g = gw.current;
      if (!g) return;
      try {
        await g.configSet('approvals.mode', mode, sessionId ?? undefined);
      } catch (e: any) {
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `approvals: ${errMsg(e)}` }]);
      }
    },
    [sessionId],
  );

  const connect = useCallback(
    async (h: string, user: string, pw: string) => {
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
          try {
            await withTimeout(openSessionRef.current(list[0]), 25000);
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

  const login = async () => {
    const pw = password || (await getPassword()) || '';
    if (!host.trim() || !username.trim() || !pw) {
      setError('Fill host, username and password');
      return;
    }
    await connect(host.trim(), username.trim(), pw);
  };

  const logout = async () => {
    gw.current?.close();
    gw.current = null;
    cookie.current = '';
    liveThinkAid.current = null;
    draftsRef.current.clear();
    setInputRaw('');
    await clearCookie();
    setAuthed(false);
    setSessionId(null);
    setSessionKey(null);
    setMessages([]);
    setSessions([]);
    setSessionInfo(null);
    setUsageInfo(null);
    setInfoOpen(false);
    router.replace('/login');
  };

  // ── Sessions ─────────────────────────────────────────────────────────────

  const openSession = async (s: SessionSummary) => {
    const g = gw.current;
    if (!g) {
      setError('Not connected — please login again');
      return;
    }
    setOpeningId(s.id);
    setError(null);
    liveThinkAid.current = null;
    liveTools.current.clear();
    liveToolAid.current = null;
    liveTurnTools.current = [];
    try {
      // resume mints a FRESH live runtime id — history/submit/interrupt must use
      // the returned session_id, NOT the stored id (server keeps two id spaces).
      const r: any = await g.resume(s.id);
      const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : s.id;
      // Resume carries the session's todo snapshot; restore the checklist.
      setTodos(normalizeTodos(r?.todo_state));
      // Full transcript via REST first (tool RESULT content + reasoning) —
      // WS session.history is only a compact projection. Stored id, not live.
      let hist: HistoryMessage[];
      try {
        // Gate on the cookie ONLY as a fallback signal: on web the jar is empty
        // (JS can't read Set-Cookie) while the browser cookie still authenticates
        // via `credentials: 'include'`, so always try REST.
        hist = await getSessionMessages(host, cookie.current, s.id);
      } catch {
        hist = [];
      }
      if (hist.length === 0) hist = await g.history(liveId);
      setSessionKey(s.id);
      setSessionId(liveId);
      draftKeyRef.current = s.id;
      setInputRaw(draftsRef.current.get(s.id) ?? '');
      setAttachments([]);
      setSessionInfo(null);
      setUsageInfo(null);
      setSessionTitle(s.title || '');
      // Reasoning rides on the assistant message (sidecar, not its own role) —
      // restore it as a thinking bubble above its answer, like the live view.
      const items = historyToItems(hist);
      setMessages(items);
      queuedRef.current = [];
      setQueued([]);
      setQueueParked(false);
      setTodos([]);
      setSubagents([]);
      router.push('/chat');
    } catch (e) {
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
      setOpeningId(null);
    }
  };
  openSessionRef.current = openSession;

  const newSession = async () => {
    const g = gw.current;
    if (!g) return;
    setBusy(true);
    setError(null);
    try {
      const { sessionId: sid, storedSessionId } = await g.createSession({
        ...(model ? { model } : {}),
        ...(modelProvider ? { provider: modelProvider } : {}),
        ...(effort ? { effort } : {}),
      });
      setSessionKey(storedSessionId || sid);
      setSessionId(sid);
      setSessionTitle('');
      setMessages([]);
      queuedRef.current = [];
      setQueued([]);
      setQueueParked(false);
      setTodos([]);
      setSubagents([]);
      draftKeyRef.current = storedSessionId || sid;
      setInputRaw(draftsRef.current.get(draftKeyRef.current) ?? '');
      setAttachments([]);
      setSessionInfo(null);
      setUsageInfo(null);
      liveTools.current.clear();
      liveToolAid.current = null;
      router.push('/chat');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  newSessionRef.current = newSession;

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
    async (submitText: string, echo?: { text: string; media?: Attachment[] }, rewindRowId?: number) => {
      const g = gw.current;
      const sid = sessionId;
      if (!g || !sid) return;
      const submitOpts = rewindRowId != null ? { rewindRowId } : {};
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
      setSubagents([]);
      setMessages((prev) => [...prev, { id: aid, role: 'assistant', text: '', pending: true }]);
      setGenerating(true);
      generatingRef.current = true; // flip now: a drain before the re-render must not double-send
      try {
        const status = await g.submit(sid, submitText, submitOpts);
        if (status === 'queued') setToolLine('queued — will run after the live turn…');
      } catch (e: any) {
        let msg = e?.message ?? String(e);
        let code = e?.code;
        // Live runtime expired server-side (orphan-reaped / evicted / idle TTL) —
        // resume the STORED session for a fresh live id and retry once.
        if ((code === 4001 || /not.?found/i.test(msg)) && sessionKey) {
          try {
            const r: any = await g.resume(sessionKey);
            const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : sessionKey;
            setSessionId(liveId);
            const status = await g.submit(liveId, submitText, submitOpts);
            if (status === 'queued') setToolLine('queued — will run after the live turn…');
            return;
          } catch (e2: any) {
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
    [sessionId, sessionKey, setSessionId],
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
      const full = raw.trim();
      if (!g || !sid || generating || !full) return;
      setMessages((prev) => [...prev, { id: nid(), role: 'user', text: full }]);
      const show = (text: string) =>
        setMessages((prev) => [...prev, { id: nid(), role: 'assistant', text }]);
      const fail = (text: string) =>
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text }]);

      // slash.exec refuses skill/quick/bundle commands with 4018 — reroute those
      // through command.dispatch, whose result is the structured directive.
      const exec = async (command: string): Promise<any> => {
        try {
          const r: any = await g.slashExec(sid, command);
          if (r && typeof r === 'object' && typeof r.type === 'string') return r;
          const out = typeof r?.output === 'string' ? r.output.trim() : '';
          const warn = typeof r?.warning === 'string' ? r.warning.trim() : '';
          show([warn, out || '(no output)'].filter(Boolean).join('\n\n'));
          return null;
        } catch (e: any) {
          if (e?.code === 4018 || e?.code === 4011) {
            const { name, arg } = parseSlashCommand(command);
            return g.commandDispatch(sid, name, arg);
          }
          throw e;
        }
      };

      const handle = async (d: any): Promise<void> => {
        if (!d) return;
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
            if (typeof d.message === 'string') {
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
        setToolLine(null);
        fail(`/${name || 'command'}: ${errMsg(e)}`);
        return;
      }
      setToolLine(null);
      if (d) await handle(d);
    },
    [sessionId, generating, beginTurn, setInput],
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
    setQueueParked(false);
  }, [setQueue]);
  const resumeQueue = useCallback(() => {
    setQueueParked(false);
    drainRef.current();
  }, []);
  const sendQueuedNow = useCallback(
    (id: string) => {
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
    if (queueParkedRef.current || generatingRef.current) return;
    const next = queuedRef.current[0];
    if (!next) return;
    setQueue((prev) => prev.filter((q) => q.id !== next.id));
    void sendRef.current?.(next.text);
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
    const lastUser = [...messagesRef.current]
      .reverse()
      .find((m) => m.role === 'user' && m.rowId != null && m.text.trim());
    if (!lastUser) {
      setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: 'Nothing to regenerate yet.' }]);
      stampRowIdsRef.current();
      return;
    }
    void beginTurn(lastUser.text, undefined, lastUser.rowId as number);
  }, [sessionId, beginTurn]);

  // Large-paste handling: spill to a server file (paste.collapse) and keep the
  // placeholder inline so a wall of text doesn't bloat the prompt.
  const pasteLarge = useCallback(
    async (text: string) => {
      const g = gw.current;
      if (!g) {
        setInput(text);
        return;
      }
      try {
        const r = await g.pasteCollapse(text);
        setInput(r?.placeholder || text);
      } catch {
        setInput(text);
      }
    },
    [setInput],
  );

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    const g = gw.current;
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
        else await runSlash(text);
      }
      // A queued slash command doesn't start a turn, so drain the next one here.
      drainRef.current();
      return;
    }

    // Bytes go up BEFORE the prompt: prompt.submit is text-only, so attachments
    // travel through the dashboard files API (the route the Files tab already
    // uses) and the agent is handed the server path to read. A failed upload
    // aborts the send and leaves the input + chips in place to retry.
    let sent: { name: string; path: string; image: boolean }[] = [];
    if (files.length) {
      // Uploads take seconds — a second tap mid-flight would send the file and
      // the prompt twice.
      if (uploading.current) return;
      uploading.current = true;
      setToolLine(`uploading ${files.length} file${files.length === 1 ? '' : 's'}…`);
      try {
        sent = await uploadAttachments(files, host, cookie.current);
      } catch (e) {
        setToolLine(null);
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Upload failed: ${errMsg(e)}` }]);
        return;
      } finally {
        uploading.current = false;
      }
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
    await beginTurn(submitText, { text: shownText, media: images }, rewindRowId);
  }, [input, attachments, sessionId, host, setInput, setAttachments, beginTurn, runSlash, enqueueQueued]);
  sendRef.current = send;

  const stop = useCallback(() => {
    if (sessionId) gw.current?.interrupt(sessionId).catch(() => {});
    // An explicit halt parks the queue until the user queues again / taps Resume.
    setQueueParked(true);
  }, [sessionId]);
  stopRef.current = stop;

  // ── Session details ────────────────────────────────────────────────────

  const openInfo = async () => {
    setInfoOpen(true);
    setInfoSeq((s) => s + 1);
    const g = gw.current;
    if (!g || !sessionId) return;
    setUsageLoading(true);
    try {
      setUsageInfo(await g.usage(sessionId));
    } catch (e) {
      setUsageInfo({ error: errMsg(e) });
    } finally {
      setUsageLoading(false);
    }
  };

  // ── Ask replies ──────────────────────────────────────────────────────────

  const answerValue = useCallback(
    (value: string) => {
      if (!ask || !gw.current) return;
      gw.current.replyToAsk(ask.rpcId, { value });
      setAsk(null);
    },
    [ask],
  );

  const answerApproval = useCallback(
    (choice: string) => {
      if (!ask || !gw.current) return;
      gw.current.replyToAsk(ask.rpcId, { choice });
      setAsk(null);
    },
    [ask],
  );

  const dismissAsk = useCallback(() => setAsk(null), []);

  // ── Session management / steering / model defaults ─────────────────────

  const renameSession = useCallback(
    async (title: string) => {
      const g = gw.current;
      const sid = sessionId ?? sessionKey;
      const t = title.trim();
      if (!g || !sid || !t) return;
      await g.rename(sid, t);
      setSessionTitle(t);
      if (sessionKey) {
        const sk = sessionKey;
        setSessions((prev) => prev.map((s) => (s.id === sk ? { ...s, title: t } : s)));
      }
    },
    [sessionId, sessionKey],
  );
  renameSessionRef.current = renameSession;

  const deleteSessionById = useCallback(
    async (storedId: string) => {
      const g = gw.current;
      if (!g) return;
      try {
        await g.deleteSession(storedId);
      } catch {
        // Fall back to close when the backend has no delete route.
        try {
          await g.closeSession(storedId);
        } catch (e) {
          setError(errMsg(e));
          return;
        }
      }
      setSessions((prev) => prev.filter((s) => s.id !== storedId));
      draftsRef.current.delete(storedId);
      if (sessionKey === storedId) {
        setSessionKey(null);
        setSessionId(null);
        setSessionTitle('');
        setMessages([]);
        setInputRaw('');
        setSessionInfo(null);
        setUsageInfo(null);
        router.replace('/chat');
      }
    },
    [sessionKey],
  );

  const closeCurrent = useCallback(async () => {
    const g = gw.current;
    if (!g || !sessionId) return;
    await g.closeSession(sessionId);
  }, [sessionId]);

  const redirectLive = useCallback(
    async (text: string) => {
      const g = gw.current;
      const t = text.trim();
      if (!g || !sessionId || !t) return;
      setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `↪ steer: ${t.slice(0, 120)}` }]);
      try {
        const r: any = await g.redirect(sessionId, t);
        // The turn was already past its steerable point, so the server keeps
        // the text as the next user turn instead of dropping it.
        if (r?.status === 'queued') {
          setMessages((prev) => [
            ...prev,
            { id: nid(), role: 'notice', text: '↪ too late to steer this turn — queued as the next message' },
          ]);
        }
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        // Live runtime expired server-side — same recovery as send().
        if ((e?.code === 4001 || /not.?found/i.test(msg)) && sessionKey) {
          try {
            const r: any = await g.resume(sessionKey);
            const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : sessionKey;
            setSessionId(liveId);
            await g.redirect(liveId, t);
            return;
          } catch (e2) {
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
      setModelProvider(providerSlug);
      setModel(modelId);
      if (!host || !cookie.current) return;
      setToolLine('setting global default…');
      try {
        await setMainModel(host, cookie.current, providerSlug, modelId);
        setMessages((prev) => [
          ...prev,
          { id: nid(), role: 'notice', text: `Global default → ${providerSlug ? `${providerSlug}:` : ''}${modelId}` },
        ]);
      } catch (e) {
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Global set failed: ${errMsg(e)}` }]);
      } finally {
        setToolLine(null);
      }
    },
    [host],
  );

  const jumpToRecent = useCallback(async () => {
    const g = gw.current;
    if (!g) return;
    setBusy(true);
    try {
      const recentId = await g.mostRecent();
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
        const r: any = await g.resume(recentId);
        const liveId = typeof r?.session_id === 'string' && r.session_id ? r.session_id : recentId;
        setSessionKey(recentId);
        setSessionId(liveId);
        setSessionTitle('');
        setMessages([]);
        router.push('/chat');
      } catch (e) {
        setError(errMsg(e));
      }
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, refreshSessions]);

  const getGw = useCallback(() => gw.current, []);
  const getCookie = useCallback(() => cookie.current, []);

  const opsGet = useCallback(async (path: string) => dashboardOpsGet(host, cookie.current, path), [host]);
  const opsMut = useCallback(
    async (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) =>
      dashboardOpsMut(host, cookie.current, path, method, body),
    [host],
  );

  const value: AppStore = {
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
    sessions,
    openingId,
    sessionId,
    sessionTitle,
    messages,
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
    connect,
    login,
    logout,
    refreshSessions,
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
    todos,
    subagents,
    refreshToolResults,
    pickModel,
    copyText,
    answerValue,
    answerApproval,
    dismissAsk,
    theme,
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
    getCookie,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
