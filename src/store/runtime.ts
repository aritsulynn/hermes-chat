// Shared store runtime.
//
// These refs cross slice boundaries (the gateway socket, cookie jar, profile/
// connection epochs, live-transcript mirrors, and the send/drain plumbing).
// Hooks them once here and hand the same object to slices, instead of the
// provider threading a dozen individual refs into every slice call.
import { useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { AskOwner } from '../lib/ask-inbox';
import { DEFAULT_PROFILE } from '../lib/constants';
import type { GatewayWs } from '../lib/gateway-ws';
import type { UiMessage } from '../utils/messages';

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
  };
}
