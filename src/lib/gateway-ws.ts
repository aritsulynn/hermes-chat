// TUI-gateway WebSocket client — JSON-RPC 2.0 over /api/ws?ticket=.
// Verified against hermes-agent source:
//   tui_gateway/ws.py            (framing, token coalescing, gateway.ready)
//   tui_gateway/methods_session.py (session.list/create/resume/history/close/
//                                  interrupt/redirect/events.since)
//   tui_gateway/methods_prompt.py  (prompt.submit → {status:"streaming"|"queued"})
//   tui_gateway/agent_callbacks.py (event names: message.*, tool.*, reasoning.*)
//   tui_gateway/server_requests.py (server→client asks: id "srq-*", must reply
//                                  with the same id; advertise via
//                                  client.capabilities {server_requests:true})
//
// Wire shape (both directions):
//   client→server RPC:  {jsonrpc:"2.0", id:<int>, method, params:{...}}
//   server→client reply:{jsonrpc:"2.0", id:<same>, result:{...} | error:{code,message,data?}}
//   server→client event:{jsonrpc:"2.0", method:"event", params:{type, session_id?, ...payload}}
//   server→client ask:  {jsonrpc:"2.0", id:"srq-...", method, params:{session_id, ...}}
//     → client replies  {jsonrpc:"2.0", id:"srq-...", result:{...}}
//     → on timeout/cancel the server sends {method:"event", params:{type:"request.cancel", id, ...}}

export type ConnState = 'idle' | 'connecting' | 'ready' | 'reconnecting' | 'closed' | 'auth-expired';

export interface RpcError {
  code: number;
  message: string;
  data?: any;
}

export interface SessionSummary {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  source: string;
  startedAt: number;
}

export interface HistoryMessage {
  role: string;
  content: string;
  rowId?: number;
  reasoning?: string;
  name?: string;
  /** Tool command / primary arg (REST history joins it from tool_calls). */
  command?: string;
  /** Authoring time (Unix seconds). */
  ts?: number;
}

/** One `/`-wheel row from `complete.slash` (tui_gateway/contracts/tools_commands.py). */
export interface SlashCompletionItem {
  /** Replacement token, usually `/name` (may carry a trailing space). */
  text: string;
  /** Human label; the server defaults it to `text`. */
  display: string;
  /** One-line description. */
  meta: string;
  /** 'command' | 'skill' on slash completions. */
  kind?: string;
}

/** A `complete.*` payload: rows plus the column the accepted row replaces from. */
export interface SlashCompletionsResult {
  items: SlashCompletionItem[];
  replaceFrom: number;
}

/** Normalise a `complete.*` result's `items` rows (same shape for slash + path). */
function completionItems(r: any): SlashCompletionItem[] {
  const rows = Array.isArray(r?.items) ? r.items : [];
  return rows
    .map(
      (it: any): SlashCompletionItem => ({
        text: typeof it?.text === 'string' ? it.text : '',
        display: typeof it?.display === 'string' ? it.display : '',
        meta: typeof it?.meta === 'string' ? it.meta : '',
        ...(typeof it?.kind === 'string' ? { kind: it.kind } : {}),
      }),
    )
    .filter((it: SlashCompletionItem) => it.text.trim().length > 0);
}

/** Assistant detail sidecars (see _history_to_messages): reasoning arrives on
 *  the assistant message itself, not as its own role. */
function reasoningTextOf(m: any): string {
  const parts: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === 'string') {
      if (v.trim()) parts.push(v);
    } else if (Array.isArray(v)) {
      v.forEach(push);
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      for (const k of ['text', 'content', 'summary']) {
        if (typeof o[k] === 'string' && (o[k] as string).trim()) {
          parts.push(o[k] as string);
          break;
        }
      }
    }
  };
  push(m?.reasoning);
  push(m?.reasoning_content);
  push(m?.reasoning_details);
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true))).join('\n').trim();
}

export interface ServerAsk {
  rpcId: string; // "srq-..." — reply with this id
  method: string; // e.g. "clarify", "approval", "sudo", "secret", "vault.unlock_prompt"
  sessionId?: string;
  params: Record<string, any>;
}

export interface GatewayEvents {
  onState?: (s: ConnState) => void;
  onToken?: (sessionId: string, delta: string) => void;
  onReasoning?: (sessionId: string, delta: string) => void;
  onInterim?: (sessionId: string, text: string) => void;
  onTool?: (sessionId: string, info: { name?: string; preview?: string; summary?: string; inlineDiff?: string; result?: unknown; args?: unknown; context?: string; toolId?: string; phase: 'start' | 'progress' | 'generating' | 'complete' }) => void;
  onComplete?: (sessionId: string, text: string, raw?: any) => void;
  onNotice?: (sessionId: string, text: string) => void;
  onSessionInfo?: (sid: string, info: any) => void;
  /** Agent todo snapshot (`{todos, revision}`) — `todo.updated`. */
  onTodo?: (sessionId: string, payload: any) => void;
  /** After a reconnect, the replay ring had already dropped the gap — callers
   *  should reload the transcript instead of trusting the partial replay. */
  onReplayTruncated?: (sessionId: string) => void;
  onAsk?: (ask: ServerAsk) => void;
  onAskCancel?: (rpcId: string) => void;
  onEvent?: (type: string, params: any) => void;
}

export interface ConnectOpts {
  wsUrl: string; // wss?://host:port/api/ws?ticket=... (single-use, ~30s TTL)
  events: GatewayEvents;
  /** Mint a fresh ticket + URL before every (re)connect. Required for reconnect. */
  refreshUrl?: () => Promise<string>;
  /** Sessions whose missed events should be replayed after a reconnect (the
   *  app shows one session, so replaying others would corrupt its state). */
  replaySessions?: () => string[];
  heartbeatMs?: number; // default 15000 (gateway.ping)
  maxBackoffMs?: number; // default 15000
}

/** In-app WS diagnostics — surfaced in the connect error so a failed
 *  handshake can be told apart (TCP refused vs auth close vs silent server). */
export interface WsDebug {
  opens: number;
  errors: number;
  closes: Array<{ code?: number; reason?: string }>;
  lastEvent: string | null;
}

const PING_MS = 15000;

let nextId = 1;

export class GatewayWs {
  private ws: WebSocket | null = null;
  private url: string;
  private events: GatewayEvents;
  private refreshUrl?: () => Promise<string>;
  private replaySessions?: () => string[];
  private heartbeatMs: number;
  private maxBackoffMs: number;
  private pending = new Map<number | string, { ok: (r: any) => void; fail: (e: RpcError) => void; timer: ReturnType<typeof setTimeout> }>();
  private state: ConnState = 'idle';
  private closed = false;
  private backoff = 1000;
  private pingTimer: any = null;
  private reconnectTimer: any = null;
  private readyResolve: ((v: boolean) => void) | null = null;
  private dbg: WsDebug = { opens: 0, errors: 0, closes: [], lastEvent: null };
  // Reconnect replay: highest seq seen per session, the backend's process epoch,
  // and the live-frame hold used while a replay fetch is in flight.
  private lastSeq = new Map<string, number>();
  private replayEpoch: string | null = null;
  private replaying = false;
  private replayHold: Array<{ type: string; params: any }> | null = null;
  // Token coalescing — deltas arrive ~30Hz; flushing per frame = setState storm.
  // Buffer per session and flush at most every 50ms (or on turn end).
  private tokenBuf = new Map<string, string>();
  private reasoningBuf = new Map<string, string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Snapshot of handshake diagnostics for error messages / debugging. */
  wsDebug(): WsDebug {
    return { opens: this.dbg.opens, errors: this.dbg.errors, closes: [...this.dbg.closes], lastEvent: this.dbg.lastEvent };
  }

  constructor(opts: ConnectOpts) {
    this.url = opts.wsUrl;
    this.events = opts.events;
    this.refreshUrl = opts.refreshUrl;
    this.replaySessions = opts.replaySessions;
    this.heartbeatMs = opts.heartbeatMs ?? PING_MS;
    this.maxBackoffMs = opts.maxBackoffMs ?? 15000;
  }

  private setState(s: ConnState) {
    this.state = s;
    this.events.onState?.(s);
  }

  /** Connect and wait for gateway.ready. Resolves true on ready, false on
   *  timeout/close/auth-reject so callers never hang forever. */
  connect(timeoutMs = 15000): Promise<boolean> {
    this.closed = false;
    return new Promise((resolve) => {
      let done = false;
      const finish = (v: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.readyResolve = null;
        resolve(v);
      };
      this.readyResolve = finish;
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.dial();
    });
  }

  close() {
    this.closed = true;
    this.flushBuffers();
    this.clearTimers();
    try {
      (this.ws as any)?.close?.();
    } catch {}
    this.ws = null;
    this.failAllPending({ code: -32000, message: 'client closed' });
    // Unblock a connect() that is still waiting for gateway.ready.
    this.readyResolve?.(false);
    this.readyResolve = null;
    this.setState('closed');
  }

  private clearTimers() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.pingTimer = null;
    this.reconnectTimer = null;
    this.flushTimer = null;
  }

  private dial() {
    if (this.closed) return;
    this.setState(this.backoff > 1000 ? 'reconnecting' : 'connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.scheduleReconnect();
    }
    // Never orphan the prior socket — close it before replacing.
    try {
      (this.ws as any)?.close?.();
    } catch {}
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.dbg.opens++;
      this.startHeartbeat();
      // Advertise server-request answering so the backend actually sends
      // clarify/approval frames instead of dropping them (server_requests.py).
      this.call('client.capabilities', { server_requests: true }).catch(() => {});
    };

    ws.onmessage = (ev: any) => {
      let msg: any;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      this.route(msg);
    };

    ws.onerror = () => {
      // onclose follows with the real outcome; count it for diagnostics.
      this.dbg.errors++;
    };

    ws.onclose = (ev: any) => {
      this.clearTimers();
      this.dbg.closes.push({ code: typeof ev?.code === 'number' ? ev.code : undefined, reason: ev?.reason ? String(ev.reason) : undefined });
      if (this.dbg.closes.length > 5) this.dbg.closes.shift();
      if (this.closed) return;
      // 4401/4403/4408 = credential rejected → refreshing the ticket won't help
      // without a fresh login.
      if (ev?.code === 4401 || ev?.code === 4403 || ev?.code === 4408) {
        this.setState('auth-expired');
        this.readyResolve?.(false);
        this.readyResolve = null;
        return;
      }
      this.scheduleReconnect();
    };
  }

  private async scheduleReconnect() {
    if (this.closed) return;
    this.setState('reconnecting');
    if (this.refreshUrl) {
      try {
        this.url = await this.refreshUrl();
        this.backoff = 1000;
      } catch {
        // Mint failed (cookie expired?) — back off and retry; ultimately
        // surfaces as auth-expired when the app re-logs-in.
      }
    }
    if (this.closed) return;
    const wait = Math.min(this.backoff, this.maxBackoffMs);
    this.backoff = Math.min(this.backoff * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => this.dial(), wait);
  }

  private startHeartbeat() {
    this.clearTimers();
    let pingInFlight = false;
    const beat = () => {
      if (pingInFlight) return;
      pingInFlight = true;
      this.call('gateway.ping', {}).catch(() => {}).finally(() => {
        pingInFlight = false;
      });
    };
    this.pingTimer = setInterval(beat, this.heartbeatMs);
  }

  private failAllPending(err: RpcError) {
    for (const [, p] of this.pending) {
      try {
        clearTimeout(p.timer);
        p.fail(err);
      } catch {}
    }
    this.pending.clear();
  }

  // ── RPC ────────────────────────────────────────────────────────────────

  call(method: string, params: Record<string, any> = {}, timeoutMs = 120000): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || (this.ws as any).readyState !== 1) {
        reject({ code: -32000, message: 'not connected' } satisfies RpcError);
        return;
      }
      const id = nextId++;
      // Safety timeout so a lost reply never hangs the UI forever.
      const timer = setTimeout(() => {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          p.fail({ code: -32000, message: 'RPC timeout' });
        }
      }, timeoutMs);
      // Clear the safety timer as soon as the reply settles.
      this.pending.set(id, {
        ok: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        fail: (e) => {
          clearTimeout(timer);
          reject(e);
        },
        timer,
      });
      try {
        this.ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (e) {
        const p = this.pending.get(id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(id);
        }
        reject({ code: -32000, message: String(e) } satisfies RpcError);
      }
    });
  }

  /** Reply to a server→client ask (id "srq-..."). */
  replyToAsk(rpcId: string, result: Record<string, any>) {
    try {
      this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result }));
    } catch {}
  }

  // ── Session methods (thin wrappers; result shapes per methods_session.py) ─

  async listSessions(limit = 100): Promise<SessionSummary[]> {
    const r = await this.call('session.list', { limit });
    const rows = r?.sessions ?? [];
    return rows.map((s: any) => ({
      id: String(s?.id ?? ''),
      title: String(s?.title ?? ''),
      preview: String(s?.preview ?? ''),
      messageCount: Number(s?.message_count ?? 0),
      source: String(s?.source ?? ''),
      startedAt: Number(s?.started_at ?? 0),
    }));
  }

  async mostRecent(): Promise<string | null> {
    try {
      const r = await this.call('session.most_recent', {});
      return typeof r?.session_id === 'string' ? r.session_id : null;
    } catch {
      return null;
    }
  }

  async createSession(opts: { title?: string; model?: string; provider?: string; effort?: string } = {}): Promise<{ sessionId: string; storedSessionId: string }> {
    const r = await this.call('session.create', {
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
      // Backend name is reasoning_effort (low/medium/high/xhigh); parse
      // failures are ignored server-side, so this never breaks create.
      ...(opts.effort ? { reasoning_effort: opts.effort.toLowerCase() } : {}),
    });
    return { sessionId: String(r?.session_id ?? ''), storedSessionId: String(r?.stored_session_id ?? '') };
  }

  /** Attach to a live session / reload durable one. Returns live payload. */
  resume(sessionId: string, omitMessages = false): Promise<any> {
    return this.call('session.resume', { session_id: sessionId, omit_messages: omitMessages });
  }

  async history(sessionId: string): Promise<HistoryMessage[]> {
    const r = await this.call('session.history', { session_id: sessionId });
    const msgs = r?.messages ?? [];
    // Server shape is {role, text, ...} (see _history_to_messages); older
    // payloads used `content`. Prefer text, fall back to content.
    return msgs.map((m: any) => {
      // Tool rows are {role:'tool', name, context, args} — no text/content.
      if (m?.role === 'tool') {
        const name = typeof m?.name === 'string' ? m.name : '';
        const ctx = typeof m?.context === 'string' ? m.context : '';
        return { role: 'tool', content: ctx || name, ...(name ? { name } : {}) };
      }
      let text = '';
      if (typeof m?.text === 'string') text = m.text;
      else if (typeof m?.content === 'string') text = m.content;
      else if (m?.text != null || m?.content != null) {
        try {
          text = JSON.stringify(m?.text ?? m?.content);
        } catch {
          text = '';
        }
      }
      const reasoning = reasoningTextOf(m);
      return {
        role: String(m?.role ?? ''),
        content: text,
        ...(typeof m?.row_id === 'number' ? { rowId: m.row_id } : {}),
        ...(typeof m?.timestamp === 'number' ? { ts: m.timestamp } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
    });
  }

  async submit(sessionId: string, text: string, opts: { queued?: boolean; rewindRowId?: number } = {}): Promise<'streaming' | 'queued'> {
    // NOTE: this backend validates params strictly — no model/provider/effort
    // here (they 400 "Extra inputs are not permitted"). Per-message model
    // override does not exist; switching is via slash.exec (/model).
    // A rewind/edit/regenerate cut needs BOTH `confirm_truncate` and a durable
    // target (`truncate_before_row_id`); ordinal-only cuts are refused for
    // durable sessions.
    const r = await this.call('prompt.submit', {
      session_id: sessionId,
      text,
      ...(opts.queued ? { queued: true } : {}),
      ...(opts.rewindRowId != null
        ? { truncate_before_row_id: opts.rewindRowId, confirm_truncate: true }
        : {}),
    });
    return r?.status === 'queued' ? 'queued' : 'streaming';
  }

  interrupt(sessionId: string): Promise<any> {
    return this.call('session.interrupt', { session_id: sessionId });
  }

  /** Steer the live turn (correction while generating; backend queues or rewrites). */
  redirect(sessionId: string, text: string): Promise<any> {
    return this.call('session.redirect', { session_id: sessionId, text });
  }

  rename(sessionId: string, title: string): Promise<any> {
    return this.call('session.title', { session_id: sessionId, title });
  }

  // ── Model picker ───────────────────────────────────────────────────────
  // Same payload builder as REST GET /api/model/options (see dashboard.ts).

  async modelOptions(sessionId?: string): Promise<any> {
    return this.call('model.options', sessionId ? { session_id: sessionId } : {});
  }

  /**
   * Session-scoped switch ("this chat") — the /model slash command, WITHOUT
   * --global so config.yaml is untouched. Goes through slash.exec (the slash
   * worker runs the switch + mirrors it onto the live agent).
   * NOTE: command.dispatch is NOT used — this backend answers 5030
   * "not a quick/plugin/bundle/skill command: model" for it.
   */
  switchModel(sessionId: string, model: string, provider?: string): Promise<any> {
    const arg = provider ? `${model} --provider ${provider}` : model;
    return this.call('slash.exec', { session_id: sessionId, command: `/model ${arg}` });
  }

  deleteSession(sessionId: string): Promise<any> {
    return this.call('session.delete', { session_id: sessionId });
  }

  /** Fork the current session into an independent copy (`session.branch`). */
  branchSession(sessionId: string, name?: string): Promise<any> {
    return this.call('session.branch', { session_id: sessionId, ...(name ? { name } : {}) });
  }

  closeSession(sessionId: string): Promise<any> {
    return this.call('session.close', { session_id: sessionId });
  }

  // ── Slash commands + @ references ──────────────────────────────────────
  // `complete.slash` backs the composer's "/" command wheel; `complete.path`
  // backs `@` references (files, folders, URLs, profiles, plugin providers).
  // Both return the same row shape (tui_gateway/methods_complete.py), so the
  // client renders them verbatim.

  async slashCompletions(text: string, sessionId?: string): Promise<SlashCompletionsResult> {
    const r = await this.call('complete.slash', {
      text,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
    return { items: completionItems(r), replaceFrom: typeof r?.replace_from === 'number' ? r.replace_from : 1 };
  }

  /** `@…` completions for the word under the composer caret (the whole token,
   *  e.g. `@`, `@src/ap`, `@file:src/`). */
  async pathCompletions(word: string, sessionId?: string): Promise<SlashCompletionsResult> {
    const r = await this.call('complete.path', {
      word,
      ...(sessionId ? { session_id: sessionId } : {}),
    });
    return { items: completionItems(r), replaceFrom: 0 };
  }

  /** Run one slash command (live shortcut or the session's slash worker). The
   *  result is plain `{output}` text or a `command.dispatch` directive (`{type}`). */
  slashExec(sessionId: string, command: string): Promise<any> {
    return this.call('slash.exec', { session_id: sessionId, command });
  }

  /** Structured fallback for skill / quick / bundle / alias commands that the
   *  slash worker refuses (4018) — see command.dispatch. */
  commandDispatch(sessionId: string, name: string, arg = ''): Promise<any> {
    return this.call('command.dispatch', {
      name: name.replace(/^\/+/, ''),
      arg,
      session_id: sessionId,
    });
  }

  /** Categorized slash catalog: per-command `desktop=` disposition (which surface
   *  owns it) plus alias mapping. This is the live authority behind
   *  ./slash-commands — the pasted registry is only the offline fallback. */
  commandsCatalog(sessionId?: string): Promise<any> {
    return this.call('commands.catalog', sessionId ? { session_id: sessionId } : {});
  }

  /** Set a display/session config key — `/reasoning <level>` is
   *  `config.set {key:'reasoning', value:<level>}` (session-scoped unless
   *  `scope:'global'`; the slash worker only reaches config.yaml and leaves the
   *  live agent's reasoning untouched — see desktop's reasoning-slash.ts). */
  configSet(key: string, value: string, sessionId?: string, scope?: 'global' | 'session'): Promise<any> {
    return this.call('config.set', {
      key,
      value,
      ...(sessionId ? { session_id: sessionId } : {}),
      ...(scope ? { scope } : {}),
    });
  }

  configGet(key: string, sessionId?: string): Promise<any> {
    return this.call('config.get', { key, ...(sessionId ? { session_id: sessionId } : {}) });
  }

  /** Live child agents owned by this session (`subagent.list`). */
  subagents(sessionId: string): Promise<any> {
    return this.call('subagent.list', { session_id: sessionId });
  }

  /** Spill a large paste to a file on the server, returning its inline placeholder. */
  pasteCollapse(text: string): Promise<{ placeholder: string; path: string; lines: number }> {
    return this.call('paste.collapse', { text });
  }

  usage(sessionId: string): Promise<any> {
    return this.call('session.usage', { session_id: sessionId });
  }

  // ── Frame routing ──────────────────────────────────────────────────────

  private route(msg: any) {
    // 1. Reply to our own RPC (has id, no method).
    if (msg?.id !== undefined && msg?.method === undefined) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error) p.fail(msg.error as RpcError);
        else p.ok(msg.result);
      }
      return;
    }
    // 2. Server→client ask (has BOTH id "srq-*" and method) — must be answered.
    if (msg?.id !== undefined && typeof msg?.method === 'string' && String(msg.id).startsWith('srq-')) {
      this.events.onAsk?.({
        rpcId: String(msg.id),
        method: String(msg.method),
        sessionId: msg?.params?.session_id,
        params: (msg?.params ?? {}) as Record<string, any>,
      });
      return;
    }
    // 3. Plain event notification.
    const method = msg?.method;
    const params = msg?.params ?? {};
    if (method === 'event' && typeof params?.type === 'string') {
      this.routeEvent(String(params.type), params);
      return;
    }
    // Unknown frame — surface for debugging, ignore otherwise.
  }

  private sidOf(params: any): string {
    return String(params?.session_id ?? params?.sid ?? '');
  }

  /**
   * After a reconnect, pull the events missed while the socket was down
   * (`session.events.since`) and re-dispatch them, then flush any live frames
   * that arrived (and were parked) while the fetch was in flight. Only the
   * sessions the caller names are replayed — the app renders one session, so
   * replaying another would corrupt its transcript.
   */
  private async replayMissed(): Promise<void> {
    if (this.replaying) return;
    const named = this.replaySessions?.() ?? [];
    const targets = named.filter((s) => !!s && this.lastSeq.has(s));
    if (targets.length === 0) return;
    this.replaying = true;
    this.replayHold = [];
    try {
      for (const sid of targets) {
        const lastSeen = this.lastSeq.get(sid) ?? 0;
        let r: any = null;
        try {
          r = await this.call('session.events.since', { session_id: sid, last_seen: lastSeen }, 20000);
        } catch {
          continue;
        }
        const events = Array.isArray(r?.events) ? r.events : [];
        for (const ev of events) {
          const t = typeof ev?.type === 'string' ? ev.type : '';
          if (!t) continue;
          const evSid = typeof ev?.session_id === 'string' && ev.session_id ? ev.session_id : sid;
          const seq = typeof ev?.seq === 'number' ? ev.seq : undefined;
          if (seq !== undefined) {
            if (seq <= (this.lastSeq.get(evSid) ?? 0)) continue;
            this.lastSeq.set(evSid, seq);
          }
          this.dispatch(t, evSid, (ev?.payload ?? {}) as Record<string, any>);
        }
        if (r?.truncated) this.events.onReplayTruncated?.(sid);
        // Server→client asks still waiting on this session ride the answer, not
        // the event ring (see json-rpc-channel deliverOpenRequests).
        if (Array.isArray(r?.open_requests)) {
          for (const req of r.open_requests) {
            const id = String(req?.id ?? '');
            const method = String(req?.method ?? '');
            if (!id || !method) continue;
            const params = (req?.params ?? {}) as Record<string, any>;
            this.events.onAsk?.({
              rpcId: id,
              method,
              sessionId: params?.session_id ?? sid,
              params,
            });
          }
        }
      }
    } finally {
      const held = this.replayHold ?? [];
      this.replayHold = null;
      this.replaying = false;
      for (const h of held) {
        const seq = typeof h.params?.seq === 'number' ? h.params.seq : undefined;
        const hsid = this.sidOf(h.params);
        if (seq !== undefined && seq <= (this.lastSeq.get(hsid) ?? 0)) continue;
        if (seq !== undefined) this.lastSeq.set(hsid, seq);
        this.dispatch(h.type, hsid, (h.params?.payload ?? h.params ?? {}) as Record<string, any>);
      }
    }
  }

  private routeEvent(type: string, params: any) {
    const sid = this.sidOf(params);
    const seq = typeof params?.seq === 'number' ? params.seq : undefined;
    // gateway.ready is per-connection handshake, never a replayed event — always
    // deliver it, or a reconnect could be dedup-skipped and never go 'ready'.
    if (type !== 'gateway.ready' && seq !== undefined) {
      // During a replay fetch, park live seq'd frames: dispatching them now would
      // double-deliver (the replay carries the same seq) or advance the watermark
      // past the gap we're filling.
      if (this.replaying) {
        if (this.replayHold && this.replayHold.length < 500) {
          this.replayHold?.push({ type, params });
        }
        return;
      }
      const seen = this.lastSeq.get(sid) ?? 0;
      if (seq <= seen) return; // replayed / duplicate
      this.lastSeq.set(sid, seq);
      // Bound the per-session watermark map — sessions accumulate forever otherwise.
      if (this.lastSeq.size > 200) {
        const oldest = this.lastSeq.keys().next().value;
        if (oldest !== undefined) this.lastSeq.delete(oldest);
      }
    }
    // Server nests event data under params.payload (see _event_frame in
    // tui_gateway/server.py) — top-level params only carries type/session_id.
    this.dispatch(type, sid, (params?.payload ?? params ?? {}) as Record<string, any>);
  }

  /** Fan one event out to the registered callbacks (live or replayed). */
  private flushBuffers() {
    if (this.tokenBuf.size === 0 && this.reasoningBuf.size === 0) return;
    const tokens = [...this.tokenBuf.entries()];
    const reasonings = [...this.reasoningBuf.entries()];
    this.tokenBuf.clear();
    this.reasoningBuf.clear();
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    for (const [sid, t] of tokens) {
      if (t) this.events.onToken?.(sid, t);
    }
    for (const [sid, t] of reasonings) {
      if (t) this.events.onReasoning?.(sid, t);
    }
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushBuffers(), 50);
  }

  private dispatch(type: string, sid: string, body: Record<string, any>) {
    this.dbg.lastEvent = type;
    const strOf = (v: unknown) => (typeof v === 'string' ? v : '');
    switch (type) {
      case 'gateway.ready': {
        // The backend stamps a per-process `replay_epoch`; when it changes the
        // seq numbering reset, so our watermarks are meaningless — drop them.
        const epoch = strOf(body?.replay_epoch);
        if (epoch) {
          if (this.replayEpoch && epoch !== this.replayEpoch) this.lastSeq.clear();
          this.replayEpoch = epoch;
        }
        this.setState('ready');
        this.readyResolve?.(true);
        this.readyResolve = null;
        void this.replayMissed();
        break;
      }
      case 'message.delta': {
        const t = strOf(body.text);
        if (t) {
          this.tokenBuf.set(sid, (this.tokenBuf.get(sid) ?? '') + t);
          this.scheduleFlush();
        }
        break;
      }
      case 'reasoning.delta':
      case 'thinking.delta': {
        const t = strOf(body.text);
        if (t) {
          this.reasoningBuf.set(sid, (this.reasoningBuf.get(sid) ?? '') + t);
          this.scheduleFlush();
        }
        break;
      }
      case 'message.interim': {
        this.flushBuffers();
        const t = strOf(body.text);
        if (t) this.events.onInterim?.(sid, t);
        break;
      }
      case 'message.complete':
        this.flushBuffers();
        this.events.onComplete?.(sid, strOf(body.text), body);
        break;
      case 'tool.start':
        this.events.onTool?.(sid, { name: body?.name, args: body?.args, context: body?.context, toolId: strOf(body?.tool_id ?? body?.id) || undefined, phase: 'start' });
        break;
      case 'tool.progress':
        this.events.onTool?.(sid, { name: body?.name, preview: body?.preview, toolId: strOf(body?.tool_id ?? body?.id) || undefined, phase: 'progress' });
        break;
      case 'tool.generating':
        this.events.onTool?.(sid, { name: body?.name, toolId: strOf(body?.tool_id ?? body?.id) || undefined, phase: 'generating' });
        break;
      case 'tool.complete':
        this.events.onTool?.(sid, {
          name: body?.name,
          toolId: strOf(body?.tool_id ?? body?.id) || undefined,
          summary: strOf(body?.summary) || strOf(body?.preview) || undefined,
          inlineDiff: strOf(body?.inline_diff) || undefined,
          result: body?.result,
          args: body?.args,
          phase: 'complete',
        });
        break;
      case 'session.info':
        this.events.onSessionInfo?.(sid, body);
        break;
      case 'todo.updated':
        this.events.onTodo?.(sid, body);
        break;
      case 'request.cancel': {
        const id = String(body?.id ?? '');
        if (id) this.events.onAskCancel?.(id);
        break;
      }
      case 'error':
        this.events.onNotice?.(sid, strOf(body.message) || 'error');
        break;
      default:
        this.events.onEvent?.(type, body);
        break;
    }
  }
}
