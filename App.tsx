import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import { StatusBar } from 'expo-status-bar';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { checkMe, getModelOptions, getSessionMessages, mintWsTicket, passwordLogin, probeStatus, toWsUrl, type ModelProviderOption } from './src/dashboard';
import {
  clearCookie,
  getCookie,
  getPassword,
  loadConnection,
  saveCookie,
  saveHost,
  savePassword,
} from './src/connection';
import { GatewayWs, type ConnState, type HistoryMessage, type ServerAsk, type SessionSummary } from './src/gateway-ws';

// ── Message model ────────────────────────────────────────────────────────────

type Role = 'user' | 'assistant' | 'notice' | 'interim' | 'thinking' | 'tool';

interface UiMessage {
  id: string;
  role: Role;
  text: string;
  pending?: boolean;
  detail?: string;
}

let seq = 0;
const nid = () => `m${Date.now()}-${seq++}`;

// Error values from fetch/WS can be non-Error objects — never render raw.
function errMsg(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    try {
      const j = JSON.stringify(o);
      return j === '{}' ? String(o) : j;
    } catch {
      return String(o);
    }
  }
  return String(e);
}

// ── Ask helpers ──────────────────────────────────────────────────────────────
// Server asks (srq-*) and their reply shapes — see src/gateway-ws.ts header.

interface ClarifyQ {
  qid: string;
  question: string;
  choices: string[];
  multiSelect: boolean;
}

function parseClarify(ask: ServerAsk): { single: boolean; questions: ClarifyQ[] } {
  const p = ask.params;
  if (Array.isArray(p.questions) && p.questions.length > 0) {
    return {
      single: false,
      questions: p.questions.map((q: any, i: number) => ({
        qid: String(q?.qid ?? `q${i}`),
        question: String(q?.question ?? ''),
        choices: Array.isArray(q?.choices) ? q.choices.map(String) : [],
        multiSelect: q?.multi_select === true,
      })),
    };
  }
  return {
    single: true,
    questions: [
      {
        qid: String(p.qid ?? p.question_id ?? 'q0'),
        question: String(p.question ?? p.text ?? ''),
        choices: Array.isArray(p.choices)
          ? p.choices.map(String)
          : Array.isArray(p.options)
            ? p.options.map(String)
            : [],
        multiSelect: p.multi_select === true,
      },
    ],
  };
}

// ── Composer options ─────────────────────────────────────────────────────────
// Real picker inventory comes from the gateway (WS model.options, fallback
// REST GET /api/model/options). This is only the offline fallback.

const FALLBACK_PROVIDERS: ModelProviderOption[] = [
  {
    slug: '',
    name: 'Default',
    models: ['Muse Spark 1.3 Free', 'opus', 'sonnet', 'haiku'],
    totalModels: 4,
  },
];

const EFFORTS = ['Low', 'Medium', 'High', 'Xhigh'];

export interface Attachment {
  uri: string;
  name: string;
  mime?: string;
}

// ── App ──────────────────────────────────────────────────────────────────────

type Screen = 'login' | 'sessions' | 'chat';

export default function App() {
  return (
    <SafeAreaProvider>
      <AppInner />
    </SafeAreaProvider>
  );
}

function AppInner() {
  const [screen, setScreen] = useState<Screen>('login');
  const [host, setHost] = useState('http://192.168.1.8:9119');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberPw, setRememberPw] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [conn, setConn] = useState<ConnState>('idle');
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null); // stored DB id — stable across resumes
  const [sessionTitle, setSessionTitle] = useState('');
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
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
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [usageInfo, setUsageInfo] = useState<any>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const copyTimer = useRef<any>(null);
  const [toolLine, setToolLine] = useState<string | null>(null);
  const [ask, setAsk] = useState<ServerAsk | null>(null);
  // Numeric bubble cap: percent maxWidth resolves too late for Yoga to wrap
  // row-nested markdown (lists) — a pixel value constrains measurement itself.
  const { width: winW } = useWindowDimensions();
  const bubbleMax = Math.round(winW * 0.85);

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
  const listRef = useRef<FlatList<UiMessage>>(null);
  // Long-press fired: swallow the onPress that fires on release (else a
  // long-press on thinking/tool bubbles toggles them instead of selecting).
  const longFired = useRef(false);
  // True while the user sits at the bottom (following the live turn).
  // Content-size growth (stream tokens, expand thinking) auto-scrolls only
  // then — expanding an old bubble mid-list no longer yanks to the bottom.
  const stickEnd = useRef(true);
  const [booting, setBooting] = useState(true);
  const [navOpen, setNavOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Stable handle for the boot-time silent reconnect (connect is defined below).
  const connectRef = useRef<(h: string, user: string, pw: string) => Promise<void>>(async () => {});

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
        // Silent reconnect — restore the session without asking login again.
        if (c.hasCookie && c.username) {
          await connectRef.current(c.host, c.username, savedPw ?? '');
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

  const scrollEnd = useCallback((animated?: unknown) => {
    const anim = animated === false ? false : true;
    // Double-tick: one frame for layout shrink (keyboard resize), one for content.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: anim }));
    });
  }, []);

  // When the keyboard slides up the list height shrinks but content offset
  // stays — explicitly scroll so the latest message sits above the keyboard,
  // like every normal chat app. Delay covers the keyboard animation (~250ms).
  useEffect(() => {
    if (screen !== 'chat') return;
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setTimeout(() => scrollEnd(true), 50);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setTimeout(() => scrollEnd(true), 50);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, [screen, scrollEnd]);

  // Fetch picker inventory when entering a chat (WS model.options, REST fallback).
  useEffect(() => {
    if (screen === 'chat' && providers === null && !providersLoading && gw.current) {
      loadProviders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, sessionId]);

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
          scrollEnd();
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

  const refreshSessions = async (ws?: GatewayWs | null) => {
    const g = ws ?? gw.current;
    if (!g) return;
    try {
      setSessions(await g.listSessions(100));
    } catch (e) {
      setError(errMsg(e));
    }
  };

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
        if (!ok) throw new Error('WebSocket closed before gateway.ready');
        await saveHost(h, user);
        if (rememberPw && pw) await savePassword(pw);
        await refreshSessions(ws);
        setScreen('sessions');
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setBusy(false);
      }
    },
    [ensureCookie, openWs, rememberPw],
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
    await clearCookie();
    setSessionId(null);
    setSessionKey(null);
    setMessages([]);
    setSessions([]);
    setSessionInfo(null);
    setUsageInfo(null);
    setInfoOpen(false);
    setScreen('login');
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
      setScreen('chat');
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
      setAttachments([]);
      setSessionInfo(null);
      setUsageInfo(null);
      liveTools.current.clear();
      liveToolAid.current = null;
      setScreen('chat');
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Chat ─────────────────────────────────────────────────────────────────

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
    stickEnd.current = true;
    scrollEnd();
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

  const stop = () => {
    if (sessionId) gw.current?.interrupt(sessionId).catch(() => {});
  };

  // ── Session details ────────────────────────────────────────────────────

  const openInfo = async () => {
    setInfoOpen(true);
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

  const answerValue = (value: string) => {
    if (!ask || !gw.current) return;
    gw.current.replyToAsk(ask.rpcId, { value });
    setAsk(null);
  };

  const answerApproval = (choice: string) => {
    if (!ask || !gw.current) return;
    gw.current.replyToAsk(ask.rpcId, { choice });
    setAsk(null);
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (booting) {
    return (
      <SafeAreaView style={[styles.root, styles.boot]} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <ActivityIndicator size="large" />
        <Text style={styles.sub}>connecting…</Text>
      </SafeAreaView>
    );
  }

  if (screen === 'login') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={styles.loginWrap}>
            <Text style={styles.appTitle}>Hermes</Text>
            <Text style={styles.sub}>connect to your dashboard</Text>
            <Field label="Host" value={host} onChange={setHost} />
            <Field label="Username" value={username} onChange={setUsername} />
            <Field label="Password" value={password} onChange={setPassword} secure />
            <Pressable onPress={login} style={[styles.primary, busy && styles.disabled]} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Connect</Text>}
            </Pressable>
            {error && <Text style={styles.err}>{error}</Text>}
            <Text style={styles.hint}>Trusted LAN / VPN only — plain HTTP.</Text>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  if (screen === 'sessions') {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="auto" />
        <View style={styles.header}>
          <Pressable onPress={() => setNavOpen(true)} style={styles.burgerBtn} hitSlop={12}>
            <View style={styles.burgerBar} />
            <View style={styles.burgerBar} />
            <View style={styles.burgerBar} />
          </Pressable>
          <Text style={styles.title}>Sessions</Text>
        </View>
        {error && <Text style={[styles.err, styles.pad]}>{error}</Text>}
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listPad}
          renderItem={({ item }) => {
            const opening = openingId === item.id;
            return (
              <Pressable
                onPress={() => openSession(item)}
                style={styles.sessCard}
                disabled={openingId !== null}
              >
                <View style={styles.sessRow}>
                  <View style={styles.flex}>
                    <Text style={styles.sessTitle} numberOfLines={1}>
                      {item.title || '(untitled)'}
                    </Text>
                    <Text style={styles.sessMeta} numberOfLines={1}>
                      {item.source} · {item.messageCount} msgs
                    </Text>
                    {!!item.preview && (
                      <Text style={styles.sessPrev} numberOfLines={2}>
                        {item.preview}
                      </Text>
                    )}
                  </View>
                  {opening && <ActivityIndicator />}
                </View>
              </Pressable>
            );
          }}
        />
        <View style={styles.pad}>
          <Pressable onPress={newSession} style={styles.primary} disabled={busy}>
            {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>+ New session</Text>}
          </Pressable>
        </View>
        <NavDrawer
          open={navOpen}
          onClose={() => setNavOpen(false)}
          screen={screen}
          conn={conn}
          host={host}
          username={username}
          onSessions={() => {
            setScreen('sessions');
            refreshSessions();
          }}
          onRefresh={() => refreshSessions()}
          onLogout={logout}
        />
        <EdgeSwipe onOpen={() => setNavOpen(true)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar style="auto" />
      <View style={styles.header}>
        <Pressable
          onPress={() => {
            setScreen('sessions');
            refreshSessions();
          }}
          style={styles.backBtn}
          hitSlop={12}
        >
          <View style={styles.backChevron} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {sessionTitle}
        </Text>
        <Pressable onPress={openInfo} style={styles.infoBtn} hitSlop={12}>
          <View style={styles.infoDot} />
          <View style={styles.infoBar} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          style={styles.flex}
          contentContainerStyle={styles.listPad}
          onContentSizeChange={() => {
            if (stickEnd.current) scrollEnd();
          }}
          onLayout={() => {
            stickEnd.current = true;
            scrollEnd(false);
          }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            stickEnd.current =
              contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
          }}
          scrollEventThrottle={16}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => {
            const think = item.role === 'thinking';
            const typing = !think && item.pending && !item.text;
            const markdown =
              !think && item.role !== 'notice' && item.role !== 'interim' && item.role !== 'tool';
            const copyable = (item.role === 'user' || item.role === 'assistant') && !!item.text && !item.pending;
            return (
              <View
                style={[
                  styles.bubble,
                  { maxWidth: bubbleMax },
                  item.role === 'user'
                    ? styles.user
                    : think
                      ? styles.think
                      : item.role === 'interim'
                        ? styles.interim
                        : item.role === 'notice'
                          ? styles.notice
                          : item.role === 'tool'
                            ? styles.toolBubble
                            : styles.ai,
                ]}
              >
                {typing ? (
                  <TypingDots />
                ) : think ? (
                  item.text ? (
                    <Pressable
                      onPress={() => {
                        if (longFired.current) {
                          longFired.current = false;
                          return;
                        }
                        setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }));
                      }}
                      onLongPress={() => {
                        longFired.current = true;
                      }}
                    >
                      <Text
                        selectable={!!expanded[item.id]}
                        style={styles.thinkMsg}
                        numberOfLines={expanded[item.id] ? undefined : 1}
                      >
                        💭 {cleanThinking(item.text)}
                      </Text>
                    </Pressable>
                  ) : (
                    <TypingDots dim />
                  )
                ) : item.role === 'tool' ? (
                  <Pressable
                    onPress={() => {
                      if (longFired.current) {
                        longFired.current = false;
                        return;
                      }
                      setExpanded((p) => ({ ...p, [item.id]: !p[item.id] }));
                    }}
                    onLongPress={() => {
                      longFired.current = true;
                    }}
                  >
                    <Text
                      selectable={!!expanded[item.id]}
                      style={styles.toolMsg}
                      numberOfLines={expanded[item.id] ? undefined : 2}
                    >
                      {item.pending ? '⚙' : '✓'} {item.text}
                      {item.detail && expanded[item.id] ? `\n${item.detail}` : ''}
                    </Text>
                  </Pressable>
                ) : markdown ? (
                  <Markdown rules={selectableRules} style={item.role === 'user' ? mdUser : mdAi}>{flattenLists(item.text)}</Markdown>
                ) : (
                  <Text selectable style={[styles.msg, item.role === 'user' && styles.userMsg]}>
                    {item.text}
                  </Text>
                )}
                {copyable && (
                  <Pressable onPress={() => copyText(item.id, item.text)} style={styles.copyBtn} hitSlop={6}>
                    <Text style={[styles.copyText, item.role === 'user' ? styles.copyTextUser : styles.copyTextAi]}>
                      {copiedId === item.id ? '✓ Copied' : '⧉ Copy'}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          }}
        />
        {!!toolLine && (
          <Text style={styles.tool} numberOfLines={1}>
            {toolLine}
          </Text>
        )}
        <Composer
          input={input}
          setInput={setInput}
          send={send}
          stop={stop}
          generating={generating}
          scrollEnd={scrollEnd}
          model={model}
          modelProvider={modelProvider}
          providers={providers ?? FALLBACK_PROVIDERS}
          providersLoading={providersLoading}
          providersError={providersError}
          onOpenModelPicker={loadProviders}
          onPickModel={pickModel}
          effort={effort}
          setEffort={setEffort}
          attachments={attachments}
          setAttachments={setAttachments}
        />
      </KeyboardAvoidingView>
      <AskSheet
        ask={ask}
        onValue={answerValue}
        onApproval={answerApproval}
        onDismiss={() => setAsk(null)}
        gw={gw.current}
      />
      <NavDrawer
        open={navOpen}
        onClose={() => setNavOpen(false)}
        screen={screen}
        conn={conn}
        host={host}
        username={username}
        onSessions={() => {
          setScreen('sessions');
          refreshSessions();
        }}
        onRefresh={() => refreshSessions()}
        onLogout={logout}
      />
      <InfoSheet
        open={infoOpen}
        onClose={() => setInfoOpen(false)}
        title={sessionTitle}
        model={model}
        provider={modelProvider}
        info={sessionInfo}
        usage={usageInfo}
        usageLoading={usageLoading}
      />
      <EdgeSwipe onOpen={() => setNavOpen(true)} />
    </SafeAreaView>
  );
}

// ── Session info sheet ───────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

function InfoSheet({
  open,
  onClose,
  title,
  model,
  provider,
  info,
  usage,
  usageLoading,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  model: string;
  provider: string;
  info: any;
  usage: any;
  usageLoading: boolean;
}) {
  return (
    <Modal transparent animationType="slide" visible={open} onRequestClose={onClose}>
      <View style={styles.sheetWrap}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Session info</Text>
            <Pressable onPress={onClose} style={styles.xBtn} hitSlop={8}>
              <Text style={styles.xText}>✕</Text>
            </Pressable>
          </View>
          <InfoRow label="Title" value={title} />
          <InfoRow label="Model" value={typeof info?.model === 'string' && info.model ? info.model : model} />
          <InfoRow
            label="Provider"
            value={typeof info?.provider === 'string' && info.provider ? info.provider : provider || undefined}
          />
          <InfoRow label="CWD" value={typeof info?.cwd === 'string' ? info.cwd : undefined} />
          <Text style={styles.sheetSub}>Usage</Text>
          {usageLoading ? (
            <Text style={styles.sub}>loading…</Text>
          ) : (
            <ScrollView style={styles.infoScroll} keyboardShouldPersistTaps="handled">
              <Text style={styles.code}>{usage ? JSON.stringify(usage, null, 2) : '—'}</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── Ask sheet (clarify / approval / sudo / secret / vault) ───────────────────

function AskSheet({
  ask,
  onValue,
  onApproval,
  onDismiss,
  gw,
}: {
  ask: ServerAsk | null;
  onValue: (v: string) => void;
  onApproval: (c: string) => void;
  onDismiss: () => void;
  gw: GatewayWs | null;
}) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string[]>>({});

  useEffect(() => {
    setText('');
    setPicked({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.rpcId]);

  if (!ask) return null;
  const m = ask.method;

  // Batch/single clarify — answer locks per question via clarify.lock so the
  // agent sees partial progress; the final answer set resolves the request.
  if (m === 'clarify') {
    const { single, questions } = parseClarify(ask);
    const toggle = (qid: string, choice: string, multi: boolean) => {
      setPicked((prev) => {
        const cur = prev[qid] ?? [];
        const next = multi
          ? cur.includes(choice)
            ? cur.filter((c) => c !== choice)
            : [...cur, choice]
          : [choice];
        // Lock-in: server keeps it even on timeout.
        gw?.call('clarify.lock', { request_id: ask.rpcId, question_id: qid, answer: next.join(', ') }).catch(() => {});
        return { ...prev, [qid]: next };
      });
    };
    const submitAll = () => {
      if (!gw) return;
      if (single) {
        const q = questions[0];
        const ans = picked[q.qid]?.join(', ') ?? text.trim();
        gw.replyToAsk(ask.rpcId, { answer: ans });
      } else {
        const answers: Record<string, string> = {};
        for (const q of questions) answers[q.qid] = picked[q.qid]?.join(', ') ?? '';
        gw.replyToAsk(ask.rpcId, { answers });
      }
      onDismiss();
    };
    return (
      <Modal transparent animationType="slide">
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>❓ Clarify</Text>
            {questions.map((q) => (
              <View key={q.qid} style={styles.qBlock}>
                {!!q.question && <Text style={styles.qText}>{q.question}</Text>}
                <View style={styles.chips}>
                  {q.choices.map((c) => {
                    const on = (picked[q.qid] ?? []).includes(c);
                    return (
                      <Pressable key={c} onPress={() => toggle(q.qid, c, q.multiSelect)} style={[styles.chip, on && styles.chipOn]}>
                        <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                {q.choices.length === 0 && (
                  <TextInput
                    style={styles.sheetInput}
                    value={text}
                    onChangeText={setText}
                    placeholder="พิมพ์คำตอบ…"
                    multiline
                  />
                )}
              </View>
            ))}
            <View style={styles.sheetRow}>
              <Pressable onPress={submitAll} style={styles.primary}>
                <Text style={styles.primaryText}>Send answer</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Dangerous-command approval — choice comes from the payload's own list.
  if (m === 'approval') {
    const choices: string[] = Array.isArray(ask.params.choices) && ask.params.choices.length > 0
      ? ask.params.choices.map(String)
      : ['once', 'deny'];
    const cmd = ask.params.command ? String(ask.params.command) : '';
    return (
      <Modal transparent animationType="slide">
        <View style={styles.sheetWrap}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>⚠️ Allow command?</Text>
            {!!cmd && <Text style={styles.code}>{cmd}</Text>}
            {!!ask.params.preview && <Text style={styles.qText}>{String(ask.params.preview)}</Text>}
            <View style={styles.chips}>
              {choices.map((c) => (
                <Pressable key={c} onPress={() => onApproval(c)} style={[styles.chip, c === 'deny' && styles.chipDeny]}>
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    );
  }

  // Sudo / secret / vault / GUI reads — single masked string under "value".
  const label =
    m === 'sudo'
      ? '🔑 Sudo password'
      : m === 'secret'
        ? `🔐 ${String(ask.params.prompt ?? ask.params.env_var ?? 'Secret')}`
        : m.startsWith('vault.')
          ? `🔐 ${String(ask.params.display_name ?? ask.params.site ?? m)}`
          : `❔ ${m}`;
  return (
    <Modal transparent animationType="slide">
      <View style={styles.sheetWrap}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{label}</Text>
          {!!ask.params.command && <Text style={styles.code}>{String(ask.params.command)}</Text>}
          <TextInput
            style={styles.sheetInput}
            value={text}
            onChangeText={setText}
            placeholder="…"
            secureTextEntry
            autoFocus
          />
          <View style={styles.sheetRow}>
            <Pressable onPress={() => onValue('')} style={styles.smallBtn}>
              <Text>Skip</Text>
            </Pressable>
            <Pressable onPress={() => onValue(text)} style={styles.primary}>
              <Text style={styles.primaryText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Markdown preprocessing ───────────────────────────────────────────────────

// Reasoning streams often open with a one-line activity status like
// "(✦) setting wing angle..." — not real thinking. Drop leading lines with
// that shape so the bubble shows only thinking.
function cleanThinking(text: string): string {
  const lines = text.split('\n');
  while (lines.length > 1 && /^\([^)\n]{0,12}\)\s*\S.*\.\.\.\s*$/.test(lines[0])) lines.shift();
  return lines.join('\n');
}

// react-native-markdown-display renders lists as flex rows whose width Yoga
// measures as unbounded inside an auto-width bubble — the text never wraps
// and spills out of the bubble. Flatten list markers to plain-text bullets so
// every line is a normal wrapping paragraph.
function flattenLists(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Unordered (- * +) with optional [ ]/[x] checkbox → •
      let m = line.match(/^(\s*)[-*+]\s+(?:\[[ xX]\]\s+)?(.*)$/);
      if (m) return `${m[1].slice(0, 3)}• ${m[2]}`;
      // Ordered (1. / 1)) → escape the dot so it stays a literal paragraph.
      m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
      if (m) return `${m[1].slice(0, 3)}${m[2]}\\. ${m[3]}`;
      return line;
    })
    .join('\n');
}

// ── Bits ─────────────────────────────────────────────────────────────────────

function Composer({
  input,
  setInput,
  send,
  stop,
  generating,
  scrollEnd,
  model,
  modelProvider,
  providers,
  providersLoading,
  providersError,
  onOpenModelPicker,
  onPickModel,
  effort,
  setEffort,
  attachments,
  setAttachments,
}: {
  input: string;
  setInput: (v: string) => void;
  send: () => void;
  stop: () => void;
  generating: boolean;
  scrollEnd: () => void;
  model: string;
  modelProvider: string;
  providers: ModelProviderOption[];
  providersLoading: boolean;
  providersError: string | null;
  onOpenModelPicker: () => void;
  onPickModel: (providerSlug: string, modelId: string) => void;
  effort: string;
  setEffort: (v: string) => void;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [menu, setMenu] = useState<null | 'plus' | 'model' | 'effort'>(null);
  const [kbOpen, setKbOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKbOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (menu === 'model') {
      setQuery('');
      onOpenModelPicker();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);
  const canSend = !!input.trim() || attachments.length > 0;

  const pickImage = async () => {
    setMenu(null);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });
      if (!r.canceled && r.assets?.length) {
        const picked = r.assets.map((a, i) => ({
          uri: a.uri,
          name: a.fileName ?? `image-${Date.now()}-${i}.jpg`,
          mime: a.mimeType,
        }));
        setAttachments([...attachments, ...picked]);
      }
    } catch {}
  };

  const pickFile = async () => {
    setMenu(null);
    try {
      const r = await DocumentPicker.getDocumentAsync({ multiple: true });
      if (!r.canceled && r.assets?.length) {
        const picked = r.assets.map((a) => ({
          uri: a.uri,
          name: a.name ?? 'file',
          mime: a.mimeType,
        }));
        setAttachments([...attachments, ...picked]);
      }
    } catch {}
  };

  const modelLabel = modelProvider ? `${modelProvider}:${model}` : model;
  const q = query.trim().toLowerCase();
  const visibleProviders = providers
    .map((p) => {
      const list = p.models ?? [];
      const models = q
        ? list.filter((m) => m.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
        : list;
      return { ...p, models };
    })
    .filter((p) => (q ? p.models.length > 0 : true));
  return (
    <View style={[styles.composerWrap, { paddingBottom: kbOpen ? 10 : Math.max(insets.bottom, 10) }]}>
      <View style={styles.composerCard}>
        {attachments.length > 0 && (
          <View style={styles.attachRow}>
            {attachments.map((a) => (
              <Pressable
                key={a.uri + a.name}
                onPress={() => setAttachments(attachments.filter((x) => x.uri !== a.uri))}
                style={styles.attachChip}
              >
                <Text style={styles.attachText} numberOfLines={1}>
                  📎 {a.name} ✕
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        <TextInput
          style={styles.composerInput}
          value={input}
          onChangeText={setInput}
          placeholder="พิมพ์ข้อความ…"
          multiline
          editable={!generating}
          returnKeyType="send"
          blurOnSubmit={false}
          submitBehavior="blurAndSubmit"
          onFocus={() => setTimeout(() => scrollEnd(), 100)}
          onSubmitEditing={send}
        />
        <View style={styles.toolbar}>
          <Pressable onPress={() => setMenu('plus')} style={styles.toolBtn} hitSlop={8}>
            <Text style={styles.toolBtnText}>＋</Text>
          </Pressable>
          <Pressable onPress={() => setMenu('model')} style={styles.modelBtn} hitSlop={8}>
            <Text style={styles.modelBtnText} numberOfLines={1}>
              {modelLabel} ▾
            </Text>
          </Pressable>
          <Pressable onPress={() => setMenu('effort')} style={styles.effortBtn} hitSlop={8}>
            <Text style={styles.effortText}>{effort}</Text>
          </Pressable>
          <View style={styles.flex} />
          {generating ? (
            <Pressable onPress={stop} style={[styles.send, styles.stop]}>
              <Text style={styles.sendText}>■</Text>
            </Pressable>
          ) : (
            <Pressable onPress={send} style={[styles.send, !canSend && styles.disabled]} disabled={!canSend}>
              <Text style={styles.sendText}>↑</Text>
            </Pressable>
          )}
        </View>
      </View>
      <Modal transparent animationType="slide" visible={menu !== null} onRequestClose={() => setMenu(null)}>
        <View style={styles.sheetWrap}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setMenu(null)} />
          <View style={styles.sheet}>
            {menu === 'plus' && (
              <>
                <Text style={styles.sheetTitle}>แนบ</Text>
                <Pressable onPress={pickImage} style={styles.menuItem}>
                  <Text style={styles.menuText}>🖼 รูปภาพ</Text>
                </Pressable>
                <Pressable onPress={pickFile} style={styles.menuItem}>
                  <Text style={styles.menuText}>📄 ไฟล์</Text>
                </Pressable>
              </>
            )}
            {menu === 'model' && (
              <>
                <View style={styles.sheetHead}>
                  <Text style={styles.sheetTitle}>Switch model (this chat)</Text>
                  <Pressable onPress={() => setMenu(null)} style={styles.xBtn} hitSlop={8}>
                    <Text style={styles.xText}>✕</Text>
                  </Pressable>
                </View>
                <TextInput
                  style={styles.searchInput}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search models and providers…"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {providersLoading && <Text style={styles.sub}>loading models…</Text>}
                {!!providersError && <Text style={styles.err}>{providersError}</Text>}
                <ScrollView
                  style={styles.pickList}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                {visibleProviders.map((p) => {
                  const count = p.models?.length ?? p.totalModels;
                  const open = q ? true : (expanded[p.slug] ?? false);
                  return (
                    <View key={p.slug || p.name}>
                      <Pressable
                        onPress={() => setExpanded((e) => ({ ...e, [p.slug]: !(e[p.slug] ?? false) }))}
                        style={styles.provRow}
                      >
                        <Text style={styles.provName}>{p.name}</Text>
                        <Text style={styles.provCount}>
                          {count} model{count === 1 ? '' : 's'}
                        </Text>
                        <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
                      </Pressable>
                      {open &&
                        (p.models ?? []).map((m) => {
                          const on = m === model && p.slug === modelProvider;
                          return (
                            <Pressable
                              key={m}
                              onPress={() => {
                                onPickModel(p.slug, m);
                                setMenu(null);
                              }}
                              style={[styles.modelRow, on && styles.menuItemOn]}
                            >
                              <Text style={[styles.menuText, on && styles.menuTextOn]} numberOfLines={1}>
                                {on ? '● ' : '○ '}{m}
                              </Text>
                            </Pressable>
                          );
                        })}
                      {open && !p.models && (
                        <Text style={styles.sub}>list unavailable — pull to refresh on server</Text>
                      )}
                    </View>
                  );
                })}
                {visibleProviders.length === 0 && !providersLoading && (
                  <Text style={styles.sub}>no matches</Text>
                )}
                </ScrollView>
              </>
            )}
            {menu === 'effort' && (
              <>
                <Text style={styles.sheetTitle}>Thinking effort</Text>
                <View style={styles.effortRow}>
                  {EFFORTS.map((e) => (
                    <Pressable
                      key={e}
                      onPress={() => {
                        setEffort(e);
                        setMenu(null);
                      }}
                      style={[styles.effortSeg, e === effort && styles.effortSegOn]}
                    >
                      <Text style={[styles.effortSegText, e === effort && styles.effortSegTextOn]}>{e}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  if (!secure) {
    return (
      <View style={styles.field}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          style={styles.fieldInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
    );
  }
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passWrap}>
        <TextInput
          style={[styles.fieldInput, styles.passInput]}
          value={value}
          onChangeText={onChange}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable onPress={() => setVisible((v) => !v)} style={styles.eyeBtn} hitSlop={8}>
          <Text style={styles.eyeText}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Nav drawer (hamburger): sessions / refresh / logout ────────────────────

function NavDrawer({
  open,
  onClose,
  screen,
  conn,
  host,
  username,
  onSessions,
  onRefresh,
  onLogout,
}: {
  open: boolean;
  onClose: () => void;
  screen: string;
  conn: ConnState;
  host: string;
  username: string;
  onSessions: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const insets = useSafeAreaInsets();
  const connLabel =
    conn === 'ready'
      ? 'Connected'
      : conn === 'connecting' || conn === 'reconnecting'
        ? 'Connecting…'
        : conn === 'auth-expired'
          ? 'Session expired'
          : 'Offline';
  // Plain static panel inside a system Modal — no custom overlay math, no
  // Animated, no fade. Swipe-left still closes via release threshold.
  const panelPan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -80 || g.vx < -0.5) onClose();
      },
    }),
  ).current;
  if (!open) return null;
  return (
    <Modal transparent animationType="none" visible onRequestClose={onClose}>
      <View style={styles.drawerWrap}>
      <View
        style={[styles.drawer, { paddingTop: Math.max(insets.top, 16) }]}
        {...panelPan.panHandlers}
      >
          <Text style={styles.drawerTitle}>Hermes</Text>
          {!!username && (
            <Text style={styles.drawerSub} numberOfLines={2}>
              {username}@{host}
            </Text>
          )}
          <Text style={styles.drawerConn}>{connLabel}</Text>
          {screen !== 'sessions' && (
            <Pressable
              onPress={() => {
                onClose();
                onSessions();
              }}
              style={styles.drawerItem}
            >
              <Text style={styles.drawerItemText}>‹ All sessions</Text>
            </Pressable>
          )}
          {screen === 'sessions' && (
            <Pressable
              onPress={() => {
                onClose();
                onRefresh();
              }}
              style={styles.drawerItem}
            >
              <Text style={styles.drawerItemText}>↻ Refresh sessions</Text>
            </Pressable>
          )}
          <View style={styles.flex} />
          <Pressable
            onPress={() => {
              onClose();
              onLogout();
            }}
            style={styles.drawerItem}
          >
            <Text style={[styles.drawerItemText, styles.drawerLogout]}>⎋ Logout</Text>
          </Pressable>
          <View style={{ height: Math.max(insets.bottom, 12) }} />
        </View>
        <Pressable style={styles.drawerBackdrop} onPress={onClose} />
      </View>
    </Modal>
  );
}

// Invisible left-edge strip: swipe right to open the drawer. Narrow and
// lifted above the bottom composer so it never eats button taps.
function EdgeSwipe({ onOpen }: { onOpen: () => void }) {
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dx > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_e, g) => {
        if (g.dx > 60) onOpen();
      },
    }),
  ).current;
  return <View style={styles.edgeZone} {...pan.panHandlers} />;
}

function TypingDots({ dim }: { dim?: boolean }) {
  const d1 = useRef(new Animated.Value(0)).current;
  const d2 = useRef(new Animated.Value(0)).current;
  const d3 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const pulse = (d: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(d, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]),
      );
    const loops = [pulse(d1, 0), pulse(d2, 150), pulse(d3, 300)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [d1, d2, d3]);
  const color = dim ? '#bbb' : '#999';
  return (
    <View style={styles.typingRow}>
      {[d1, d2, d3].map((d, i) => (
        <Animated.View
          key={i}
          style={[
            styles.typingDot,
            { backgroundColor: color, opacity: d.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  flex: { flex: 1 },
  boot: { justifyContent: 'center', alignItems: 'center', gap: 12 },
  loginWrap: { flex: 1, justifyContent: 'center', padding: 24, gap: 4 },
  appTitle: { fontSize: 32, fontWeight: '800' },
  sub: { color: '#666', marginBottom: 16 },
  field: { marginBottom: 10 },
  label: { fontSize: 12, color: '#666', marginBottom: 2 },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  passWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingRight: 4,
  },
  passInput: { flex: 1, borderWidth: 0 },
  eyeBtn: { paddingHorizontal: 10, paddingVertical: 9 },
  eyeText: { fontSize: 14, fontWeight: '600', color: '#1a73e8' },
  primary: {
    backgroundColor: '#1a73e8',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  disabled: { opacity: 0.4 },
  err: { color: '#c5221f', marginTop: 10 },
  hint: { color: '#999', fontSize: 12, marginTop: 12, textAlign: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    gap: 8,
  },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: { paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#ddd', borderRadius: 8 },
  backBtn: { paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center' },
  infoBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  infoDot: { width: 2.5, height: 2.5, borderRadius: 1.25, backgroundColor: '#111' },
  infoBar: { width: 2.5, height: 9, borderRadius: 1.25, backgroundColor: '#111' },
  burgerBtn: { paddingHorizontal: 8, paddingVertical: 8, justifyContent: 'center', gap: 4 },
  burgerBar: { width: 18, height: 2, borderRadius: 1, backgroundColor: '#111' },
  backChevron: {
    width: 13,
    height: 13,
    borderLeftWidth: 2.5,
    borderTopWidth: 2.5,
    borderColor: '#111',
    transform: [{ rotate: '-45deg' }],
    marginLeft: 5,
  },
  drawerWrap: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,.4)' },
  drawer: { width: 260, backgroundColor: '#fff', paddingHorizontal: 16, gap: 4 },
  drawerBackdrop: { flex: 1 },
  drawerTitle: { fontSize: 22, fontWeight: '800' },
  drawerSub: { fontSize: 12, color: '#666', marginTop: 2 },
  drawerConn: { fontSize: 12, color: '#666', marginTop: 2, marginBottom: 12 },
  drawerItem: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f0f0f2' },
  drawerItemText: { fontSize: 15, color: '#111' },
  drawerLogout: { color: '#c5221f' },
  edgeZone: { position: 'absolute', left: 0, top: 0, bottom: 90, width: 20 },
  pad: { padding: 14 },
  listPad: { padding: 12, gap: 8 },
  sessCard: { borderWidth: 1, borderColor: '#e3e3e6', borderRadius: 12, padding: 12 },
  sessRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sessTitle: { fontWeight: '600', fontSize: 15 },
  sessMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  sessPrev: { color: '#555', fontSize: 13, marginTop: 4 },
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  user: { alignSelf: 'flex-end', backgroundColor: '#1a73e8' },
  ai: { alignSelf: 'flex-start', backgroundColor: '#f0f0f2' },
  interim: { alignSelf: 'flex-start', backgroundColor: '#fff8e1', borderWidth: 1, borderColor: '#f0e0a0' },
  notice: { alignSelf: 'center', backgroundColor: '#fdecea' },
  msg: { fontSize: 15, lineHeight: 21, color: '#111' },
  userMsg: { color: '#fff' },
  think: { alignSelf: 'flex-start', backgroundColor: '#f7f7f9', borderWidth: 1, borderColor: '#e2e2e6' },
  thinkMsg: { fontSize: 13, lineHeight: 18, color: '#777' },
  toolBubble: { alignSelf: 'flex-start', backgroundColor: '#eef3fd', borderWidth: 1, borderColor: '#d3e1f8' },
  toolMsg: { fontSize: 13, lineHeight: 18, color: '#3b5bdb' },
  typingRow: { flexDirection: 'row', gap: 5, alignItems: 'center', paddingVertical: 6, paddingHorizontal: 2 },
  typingDot: { width: 7, height: 7, borderRadius: 3.5 },
  tool: { fontSize: 12, color: '#666', paddingHorizontal: 14, paddingBottom: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: 10,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontSize: 15,
    maxHeight: 120,
  },
  composerWrap: {
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },
  composerCard: {
    backgroundColor: '#f4f4f6',
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  composerInput: {
    fontSize: 15,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingVertical: 6,
    color: '#111',
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolBtnText: { fontSize: 20, color: '#555', fontWeight: '600' },
  modelBtn: { maxWidth: 170, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: '#e8e8ec' },
  modelBtnText: { fontSize: 13, color: '#333', fontWeight: '600' },
  effortBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8 },
  effortText: { fontSize: 13, color: '#666', fontWeight: '600' },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  attachChip: { backgroundColor: '#e8eef7', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 4, maxWidth: 220 },
  attachText: { fontSize: 12, color: '#1a73e8' },
  infoRow: { flexDirection: 'row', gap: 8, paddingVertical: 3 },
  infoLabel: { width: 72, fontSize: 13, color: '#888' },
  infoValue: { flex: 1, fontSize: 14, color: '#111' },
  infoScroll: { maxHeight: 220, marginTop: 4 },
  menuItem: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f2' },
  menuItemOn: { backgroundColor: '#f4f8ff' },
  menuText: { fontSize: 15, color: '#111' },
  menuTextOn: { color: '#1a73e8', fontWeight: '700' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  xBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  xText: { fontSize: 16, color: '#666' },
  searchInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14 },
  pickList: { maxHeight: 420 },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f2' },
  provName: { flex: 1, fontSize: 15, fontWeight: '700', color: '#111' },
  provCount: { fontSize: 13, color: '#666' },
  chev: { fontSize: 14, color: '#666', width: 20, textAlign: 'center' },
  modelRow: { paddingVertical: 10, paddingLeft: 16, borderBottomWidth: 1, borderBottomColor: '#f5f5f7' },
  effortRow: { flexDirection: 'row', gap: 6 },
  effortSeg: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  effortSegOn: { backgroundColor: '#1a73e8', borderColor: '#1a73e8' },
  effortSegText: { fontSize: 13, color: '#333', fontWeight: '600' },
  effortSegTextOn: { color: '#fff' },
  copyBtn: { alignSelf: 'flex-end', marginTop: 4, paddingHorizontal: 2, paddingVertical: 2 },
  copyText: { fontSize: 11, fontWeight: '600' },
  copyTextUser: { color: 'rgba(255,255,255,.75)' },
  copyTextAi: { color: '#999' },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a73e8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: { backgroundColor: '#c5221f' },
  sendText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 10, maxHeight: '80%' },
  sheetTitle: { fontSize: 17, fontWeight: '700' },
  sheetSub: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  sheetRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, alignItems: 'center' },
  sheetInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 10, fontSize: 15 },
  qBlock: { gap: 6 },
  qText: { fontSize: 14, color: '#333' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13, backgroundColor: '#f4f4f6', padding: 8, borderRadius: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#1a73e8', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  chipOn: { backgroundColor: '#1a73e8' },
  chipText: { color: '#1a73e8', fontSize: 14 },
  chipTextOn: { color: '#fff' },
  chipDeny: { borderColor: '#c5221f' },
});

// ── Markdown (assistant = dark on light, user = white on blue) ──────────────

// Leaf text nodes render selectable so long-press selects partial text.
const selectableRules = {
  text: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => (
    <Text key={node.key} selectable style={[inheritedStyles, styles.text]}>
      {node.content}
    </Text>
  ),
  // ^ leaf-only selectable is ignored on Android when nested — the selectable
  // must sit on the OUTERMOST Text of each block (one TextView = one
  // selectable unit). textgroup wraps a paragraph's inline spans.
  textgroup: (node: any, children: any, parent: any, styles: any) => (
    <Text key={node.key} selectable style={styles.textgroup}>
      {children}
    </Text>
  ),
  code_block: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
    let { content } = node;
    if (typeof node.content === 'string' && node.content.charAt(node.content.length - 1) === '\n') {
      content = node.content.substring(0, node.content.length - 1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.code_block]}>
        {content}
      </Text>
    );
  },
  fence: (node: any, children: any, parent: any, styles: any, inheritedStyles: any = {}) => {
    let { content } = node;
    if (typeof node.content === 'string' && node.content.charAt(node.content.length - 1) === '\n') {
      content = node.content.substring(0, node.content.length - 1);
    }
    return (
      <Text key={node.key} selectable style={[inheritedStyles, styles.fence]}>
        {content}
      </Text>
    );
  },
};

const mdAi = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#111' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#111' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#111' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#111' },
  paragraph: { marginVertical: 4 },
  link: { color: '#1a73e8' },
  blockquote: { backgroundColor: '#e8eef7', borderLeftWidth: 3, borderLeftColor: '#1a73e8', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: '#e4e4e8', borderRadius: 4, paddingHorizontal: 4, fontSize: 13 },
  fence: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: '#1e1e24', color: '#e8e8ea', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: '#ddd', height: 1, marginVertical: 8 },
  table: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6 },
  th: { padding: 6, fontWeight: '700' },
  td: { padding: 6 },
  tr: { borderBottomWidth: 1, borderColor: '#eee' },
});

const mdUser = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 21, color: '#fff' },
  heading1: { fontSize: 20, fontWeight: '700', marginVertical: 6, color: '#fff' },
  heading2: { fontSize: 18, fontWeight: '700', marginVertical: 6, color: '#fff' },
  heading3: { fontSize: 16, fontWeight: '700', marginVertical: 4, color: '#fff' },
  paragraph: { marginVertical: 4 },
  link: { color: '#cfe3ff' },
  blockquote: { backgroundColor: 'rgba(255,255,255,.15)', borderLeftWidth: 3, borderLeftColor: '#fff', paddingHorizontal: 8, paddingVertical: 4 },
  code_inline: { backgroundColor: 'rgba(255,255,255,.2)', borderRadius: 4, paddingHorizontal: 4, fontSize: 13, color: '#fff' },
  fence: { backgroundColor: 'rgba(0,0,0,.3)', color: '#fff', borderRadius: 8, padding: 10, fontSize: 13 },
  code_block: { backgroundColor: 'rgba(0,0,0,.3)', color: '#fff', borderRadius: 8, padding: 10, fontSize: 13 },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { flexDirection: 'row', marginVertical: 2 },
  bullet_list_content: { flex: 1 },
  ordered_list_content: { flex: 1 },
  hr: { backgroundColor: 'rgba(255,255,255,.4)', height: 1, marginVertical: 8 },
});
