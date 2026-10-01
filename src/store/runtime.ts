// Shared store runtime.
//
// These refs cross slice boundaries (the gateway socket, cookie jar, profile/
// connection epochs, live-transcript mirrors, and the send/drain plumbing).
// Hooks them once here and hand the same object to slices, instead of the
// provider threading a dozen individual refs into every slice call.
import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { AskOwner } from '../services/ask-inbox';
import { DEFAULT_PROFILE } from '../services/constants';
import type { GatewayWs, SessionSummary } from '../services/gateway-ws';
import type { UiMessage } from '../utils/messages';
import type { AgentProfile } from './types';

export interface StoreRuntime {
  gw: MutableRefObject<GatewayWs | null>;
  cookie: MutableRefObject<string>;
  cookieScope: MutableRefObject<string>;
  activeProfileRef: MutableRefObject<string>;
  activeProfilePreferenceRef: MutableRefObject<string | null>;
  profileEpochRef: MutableRefObject<number>;
  connectionEpochRef: MutableRefObject<number>;
  connectRequestRef: MutableRefObject<number>;
  logoutCleanupRef: MutableRefObject<Promise<void>>;
  sessionOpenEpochRef: MutableRefObject<number>;
  /** runtime session id → scoped durable owner (profile + stored id). */
  runtimeOwners: MutableRefObject<Map<string, string>>;
  /** Best-effort runtime → owner metadata, including unresolved background profiles. */
  runtimeAskOwners: MutableRefObject<Map<string, AskOwner>>;
  generatingRef: MutableRefObject<boolean>;
  sendRef: MutableRefObject<((text?: string) => Promise<void>) | null>;
  drainRef: MutableRefObject<() => void>;
  messagesRef: MutableRefObject<UiMessage[]>;
  // ── Transcript windowing (10k+ sessions) ───────────────────────────────
  // REST has no history cursor (only order+limit), so older pages grow the
  // tail limit; the store prepends just the older slice (see sliceOlderThan).
  /** REST rows covered by the current window (grows by CHAT_HISTORY_PAGE). */
  historyLimitRef: MutableRefObject<number>;
  /** True while a load-older fetch is in flight (re-entrancy guard). */
  historyLoadingRef: MutableRefObject<boolean>;
  /** True when the server has no rows older than the window. */
  historyExhaustedRef: MutableRefObject<boolean>;
  // ── Orchestrator refs ──────────────────────────────────────────────────
  profilesRef: MutableRefObject<AgentProfile[]>;
  sessionIdRef: MutableRefObject<string | null>;
  editingRowRef: MutableRefObject<number | null>;
  uploadingRef: MutableRefObject<boolean>;
  contextHydrateCancelRef: MutableRefObject<(() => void) | null>;
  contextPendingSidRef: MutableRefObject<string | null>;
  stampRowIdsRef: MutableRefObject<() => void>;
  resyncRef: MutableRefObject<() => void>;
  connectRef: MutableRefObject<(h: string, user: string, pw: string) => Promise<void>>;
  openSessionRef: MutableRefObject<
    (s: SessionSummary, options?: { navigate?: boolean }) => Promise<void>
  >;
  newSessionRef: MutableRefObject<() => Promise<void>>;
  stopRef: MutableRefObject<() => void>;
  renameSessionRef: MutableRefObject<(t: string) => Promise<void>>;
  releaseLocalTurnRef: MutableRefObject<() => void>;
}

export function useStoreRuntime(): StoreRuntime {
  return {
    gw: useRef<GatewayWs | null>(null),
    cookie: useRef<string>(''),
    cookieScope: useRef(''),
    activeProfileRef: useRef(DEFAULT_PROFILE),
    activeProfilePreferenceRef: useRef<string | null>(null),
    profileEpochRef: useRef(0),
    connectionEpochRef: useRef(0),
    connectRequestRef: useRef(0),
    logoutCleanupRef: useRef<Promise<void>>(Promise.resolve()),
    sessionOpenEpochRef: useRef(0),
    runtimeOwners: useRef<Map<string, string>>(new Map()),
    runtimeAskOwners: useRef<Map<string, AskOwner>>(new Map()),
    generatingRef: useRef(false),
    sendRef: useRef<((text?: string) => Promise<void>) | null>(null),
    drainRef: useRef<() => void>(() => {}),
    messagesRef: useRef<UiMessage[]>([]),
    historyLimitRef: useRef(0),
    historyLoadingRef: useRef(false),
    historyExhaustedRef: useRef(true),
    profilesRef: useRef<AgentProfile[]>([]),
    sessionIdRef: useRef<string | null>(null),
    editingRowRef: useRef<number | null>(null),
    uploadingRef: useRef(false),
    contextHydrateCancelRef: useRef<(() => void) | null>(null),
    contextPendingSidRef: useRef<string | null>(null),
    stampRowIdsRef: useRef<() => void>(() => {}),
    resyncRef: useRef<() => void>(() => {}),
    connectRef: useRef<(h: string, user: string, pw: string) => Promise<void>>(async () => {}),
    openSessionRef: useRef<(s: SessionSummary, options?: { navigate?: boolean }) => Promise<void>>(
      async () => {},
    ),
    newSessionRef: useRef<() => Promise<void>>(async () => {}),
    stopRef: useRef<() => void>(() => {}),
    renameSessionRef: useRef<(t: string) => Promise<void>>(async () => {}),
    releaseLocalTurnRef: useRef<() => void>(() => {}),
  };
}
