// Global app state — the full logic of the old monolithic AppInner
// (App.tsx), lifted into a context provider so the expo-router screens
// (login / sessions / chat) share one connection, one gateway socket and
// one transcript. Navigation replaced setScreen() with expo-router routes.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
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
} from './dashboard';
import type { ModelProviderOption } from './dashboard';
import { clearCookie, getCookie, getPassword, getTheme, loadConnection, saveCookie, saveHost, savePassword, saveTheme } from './connection';
import type { Theme } from './connection';
import { GatewayWs } from './gateway-ws';
import type { ConnState, HistoryMessage, ServerAsk, SessionSummary } from './gateway-ws';
import { cleanThinking, errMsg, nid } from './models';
import type { Attachment, UiMessage } from './models';
import type { Role } from './models';

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
  goSessions: () => void;
  send: () => Promise<void>;
  stop: () => void;
  openInfo: () => Promise<void>;
  getGw: () => GatewayWs | null;
  loadProviders: () => Promise<void>;
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
}

const AppContext = createContext<AppStore | null>(null);

// Rejecting timeout so a wedged server can never trap the UI on a spinner.
function withTimeout<T>(p: Promise<T>, ms: number, what = 'timed out'): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(what)), ms))]);
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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [generating, setGenerating] = useState(false);
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
  const liveAid = useRef<string | null>(null);
  const liveThinkAid = useRef<string | null>(null);
  const liveTools = useRef<Map<string, string>>(new Map());
  const liveToolAid = useRef<string | null>(null);
  const liveTurnTools = useRef<string[]>([]); // tool bubbles minted this turn, in order
  // Latest host/sessionKey for callbacks frozen in openWs (created once).
  const latest = useRef({ host, sessionKey });
  latest.current = { host, sessionKey };
  // Post-turn tool-detail fill (REST full transcript merged into live bubbles).
  const toolRefreshRef = useRef<(ids: string[]) => void>(() => {});
  toolRefreshRef.current = (ids: string[]) => {
    if (ids.length === 0) return;
    const h = latest.current.host;
    const sk = latest.current.sessionKey;
    const ck = cookie.current;
    if (!h || !sk || !ck) return;
    void (async () => {
      try {
        const items = await getSessionMessages(h, ck, sk);
        const tools = items.filter((m) => m.role === 'tool' && m.content.trim());
        if (tools.length === 0) return;
        const off = Math.max(0, tools.length - ids.length);
        const fill = new Map<string, string>();
        ids.forEach((id, i) => {
          const src = tools[off + i];
          if (src) fill.set(id, src.content);
        });
        if (fill.size === 0) return;
        setMessages((prev) => prev.map((m) => (fill.has(m.id) ? { ...m, detail: fill.get(m.id) } : m)));
      } catch {}
    })();
  };
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
              setMessages((prev) =>
                prev.map((m) => (m.id === mid ? { ...m, pending: false, ...(detail ? { detail } : {}) } : m)),
              );
              if (info.toolId) liveTools.current.delete(info.toolId);
              if (liveToolAid.current === mid) liveToolAid.current = null;
            }
            return;
          }
          setToolLine(info.name ? `⚙ ${info.name}…` : '⚙ running tool…');
          const existing = (info.toolId && liveTools.current.get(info.toolId)) || liveToolAid.current;
          if (existing) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === existing
                  ? { ...m, text: info.name || m.text, detail: info.preview || m.detail }
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
          const turnTools = liveTurnTools.current;
          liveTurnTools.current = [];
          setGenerating(false);
          setToolLine(null);
          if (aid) {
            setMessages((prev) =>
              prev.map((m) => (m.id === aid ? { ...m, text: text || m.text, pending: false } : m)),
            );
          } else if (text) {
            setMessages((prev) => [...prev, { id: nid(), role: 'assistant', text }]);
          }
          // Backfill full tool RESULT content from the REST transcript.
          toolRefreshRef.current(turnTools);
        },
        onNotice: (_sid, text) => {
          setMessages((prev) => [...prev, { id: nid(), role: 'notice', text }]);
        },
        onSessionInfo: (info) => setSessionInfo(info),
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
      // Full transcript via REST first (tool RESULT content + reasoning) —
      // WS session.history is only a compact projection. Stored id, not live.
      let hist: HistoryMessage[];
      try {
        hist = cookie.current ? await getSessionMessages(host, cookie.current, s.id) : [];
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
      setSessionTitle(s.title || '(untitled)');
      // Reasoning rides on the assistant message (sidecar, not its own role) —
      // restore it as a thinking bubble above its answer, like the live view.
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
            ...(m.name && m.content && m.content !== m.name ? { detail: m.content } : {}),
          });
        }
        if ((m.role === 'user' || m.role === 'assistant') && m.content.trim() !== '') {
          items.push({ id: nid(), role: m.role as 'user' | 'assistant', text: m.content });
        }
      }
      setMessages(items);
      router.push('/chat');
    } catch (e) {
      const msg = errMsg(e);
      if (/not.?found/i.test(msg)) {
        // Stale entry — the session is gone server-side (pruned/deleted).
        // Drop it so the list stops lying.
        setSessions((prev) => prev.filter((x) => x.id !== s.id));
        setError(`"${s.title || '(untitled)'}" ไม่มีอยู่แล้ว (โดนลบ/prune) — เอาออกจากลิสต์ให้แล้ว`);
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
      setSessionTitle('(new session)');
      setMessages([]);
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

  const goSessions = useCallback(() => {
    void refreshSessions();
    router.navigate('/sessions');
  }, [refreshSessions]);

  // ── Chat ─────────────────────────────────────────────────────────────────
  // Scrolling lives in the chat screen (it owns the FlatList ref); send()
  // only queues state — the screen scrolls after calling it.

  const send = async () => {
    const text = input.trim();
    const g = gw.current;
    const files = attachments;
    if ((!text && files.length === 0) || !g || !sessionId || generating) return;
    setInput('');
    setAttachments([]);
    const shownText = files.length
      ? [...files.map((f) => `📎 ${f.name}`), text].filter(Boolean).join('\n')
      : text;
    // Gateway has no binary upload yet — send filenames as markers so the
    // agent sees what was attached. Real file bytes wire up when the server
    // documents an upload route.
    const submitText = files.length
      ? [...files.map((f) => `[attached file: ${f.name}]`), text].filter(Boolean).join('\n')
      : text;
    setMessages((prev) => [...prev, { id: nid(), role: 'user', text: shownText }]);
    const aid = nid();
    liveAid.current = aid;
    liveThinkAid.current = null; // fresh turn → fresh thinking bubble
    liveTools.current.clear();
    liveToolAid.current = null;
    liveTurnTools.current = [];
    setMessages((prev) => [...prev, { id: aid, role: 'assistant', text: '', pending: true }]);
    setGenerating(true);
    try {
      const status = await g.submit(sessionId, submitText);
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
          const status = await g.submit(liveId, submitText);
          if (status === 'queued') setToolLine('queued — will run after the live turn…');
          return;
        } catch (e2: any) {
          msg = e2?.message ?? String(e2);
          code = e2?.code;
        }
      }
      liveAid.current = null;
      setGenerating(false);
      if (code === 4009) {
        // Session busy — ask the user to stop the live turn first.
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Session busy (${msg}). Stop the live turn and resend.` }]);
      } else {
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Send failed: ${msg}` }]);
      }
      setMessages((prev) => prev.filter((m) => m.id !== aid));
    }
  };

  const stop = useCallback(() => {
    if (sessionId) gw.current?.interrupt(sessionId).catch(() => {});
  }, [sessionId]);

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
      setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `↪ steered: ${t.slice(0, 120)}` }]);
      try {
        await g.redirect(sessionId, t);
      } catch (e) {
        setMessages((prev) => [...prev, { id: nid(), role: 'notice', text: `Steer failed: ${errMsg(e)}` }]);
      }
    },
    [sessionId],
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
        setSessionTitle('(recent session)');
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
    goSessions,
    send,
    stop,
    openInfo,
    loadProviders,
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
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
