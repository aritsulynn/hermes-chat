// Store types — the public `AppStore` contract plus profile/session shapes.
// Extracted from hooks/app-store.tsx so the context contract is readable in
// one place instead of buried above a 4k-line provider.
import type { AskInboxEntry } from '../services/ask-inbox';
import type { ModelProviderOption } from '../services/dashboard';
import type { GatewayWs, ServerAsk, SessionSummary } from '../services/gateway-ws';
import type { LiveSessionMap } from './live-sessions';
import type { Attachment, QueuedPrompt, SubagentRow, TodoItem, UiMessage } from '../utils/messages';

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

/** Session detail snapshot (`session.info`) — free-form JSON, kept verbatim. */
export type SessionInfo = Record<string, unknown>;
/** Live usage snapshot (`session.usage`) — free-form JSON, merged per turn. */
export type UsageInfo = Record<string, unknown>;
/** Honest result of the generic ops REST helpers (JSON of any shape). */
export type OpsResult = unknown;
/** Cookie-authed GET against the dashboard (`services/dashboard`). */
export type OpsGet = (path: string) => Promise<OpsResult>;
/** Cookie-authed mutation against the dashboard (`services/dashboard`). */
export type OpsMut = (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<OpsResult>;
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
  /** NOT here on purpose — `conn` has its own context (`useConn`). It flips on
   *  every socket transition, and leaving it in the shared value re-rendered
   *  all 27 useApp() consumers whenever the Android socket died on resume. */
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
  /** True while an older-history page is loading (list header spinner). */
  historyLoadingMore: boolean;
  /** True when the server has no rows older than the loaded window. */
  historyExhausted: boolean;
  /** Bubbles trimmed from the head by the window cap (refetchable via paging). */
  trimmedOlder: number;
  /** Prepend the next older history page (no-op at the start / while loading). */
  loadOlderMessages: () => Promise<boolean>;
  /** Drop the window head past the soft cap (refetchable, never the live tail). */
  trimHead: () => void;
  input: string;
  setInput: (v: string) => void;
  model: string;
  modelProvider: string;
  effort: string;
  /** Apply a thinking-effort level to the live session (and the next create). */
  applyEffort: (level: string) => Promise<void>;
  /** Toggle fast mode on the live session. */
  applyFast: (on: boolean) => Promise<void>;
  /** Reasoning display (live tool + reasoning streaming) — null while unknown. */
  showReasoning: boolean | null;
  loadReasoningDisplay: () => Promise<void>;
  applyShowReasoning: (on: boolean) => Promise<void>;
  providers: ModelProviderOption[] | null;
  providersLoading: boolean;
  providersError: string | null;
  attachments: Attachment[];
  setAttachments: (v: Attachment[]) => void;
  generating: boolean;
  copiedId: string | null;
  sessionInfo: SessionInfo | null;
  usageInfo: UsageInfo | null;
  toolLine: string | null;
  ask: ServerAsk | null;
  /** All unresolved/settled server asks, newest first. */
  askInbox: AskInboxEntry[];
  pendingAskCount: number;
  /** Open an inbox item in its owning chat when its profile is resolved. */
  openAskEntry: (entry: AskInboxEntry) => Promise<void>;
  /**
   * Answer a queued request straight from the inbox, over the JSON-RPC
   * response channel — no need to open its chat. Takes the same payload the
   * in-chat ask sheet builds: `{ value }` for sudo/secret/vault, `{ choice }`
   * for approval, `{ answer }` / `{ answers }` for clarify. False when the
   * request is no longer answerable (settled, another profile's, no socket).
   */
  respondToInbox: (key: string, result: Record<string, unknown>) => boolean;
  answerInboxApproval: (key: string, choice: string) => boolean;
  connect: (h: string, user: string, pw: string) => Promise<void>;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** Cut through the reconnect backoff and dial immediately. */
  reconnectNow: () => void;
  refreshSessions: (limit?: number) => Promise<ScopedSessionSummary[]>;
  /** Fetch the next page (limit+100) — used by drawer infinite scroll. */
  loadMoreSessions: () => Promise<ScopedSessionSummary[]>;
  sessionsHasMore: boolean;
  sessionsLoadingMore: boolean;
  openSession: (s: ScopedSessionSummary) => Promise<void>;
  newSession: () => Promise<void>;
  /** Download the open session as JSON; returns the filename and raw text. */
  exportSession: (title?: string) => Promise<{ filename: string; text: string }>;
  send: () => Promise<boolean>;
  stop: () => void;
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
  /** Stored sessions the gateway is working in right now, keyed by
   *  profile+stored id (polled from `session.active_list` while foregrounded). */
  liveSessions: LiveSessionMap;
  /** False until the first `session.active_list` poll succeeds. */
  liveSessionsKnown: boolean;
  refreshLiveSessions: () => Promise<void>;
  /** Re-fetch tool results from the REST transcript (fills expanded tool bubbles). */
  refreshToolResults: () => void;
  pickModel: (providerSlug: string, modelId: string) => Promise<void>;
  copyText: (id: string, text: string) => Promise<void>;
  answerValue: (value: string) => void;
  answerApproval: (choice: string) => boolean;
  /** Reply to the current foreground ask with its method-specific result. */
  answerAsk: (result: Record<string, unknown>) => boolean;
  dismissAsk: () => void;
  // The theme triple (theme / themeMode / setTheme) is deliberately NOT on
  // AppStore — it lives on its own context so a theme toggle does not hand all
  // ~30 useApp() consumers a new object. Read it with useThemeValue().
  renameSession: (title: string) => Promise<void>;
  deleteSessionById: (storedId: string) => Promise<void>;
  redirectLive: (text: string) => Promise<void>;
  setGlobalModel: (providerSlug: string, modelId: string) => Promise<void>;
  opsGet: OpsGet;
  opsMut: OpsMut;
  /** Session cookie — media components need it to load authed URLs. */
  getCookie: () => string;
  /** Connection + profile generation for auth-scoped REST screens. */
  getAuthScope: () => string;
}
