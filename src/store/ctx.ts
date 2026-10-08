// The shared slice context.
//
// Every slice used to declare its own `XxxSliceDeps` interface listing the 4-63
// props it wanted, and the provider spelled every one of those out at the call
// site — ~1,000 lines that did nothing but name things. Slices are called in
// dependency order (the order in useAppStore.tsx is a valid topological order,
// so a slice only ever reads fields an earlier slice or the provider already
// published), which means one accumulating object works for all of them.
//
// The provider builds `ctx` once per render and hands the same object to every
// slice, growing it with `Object.assign` as each slice returns. The values are
// the same objects the old props carried, so every `useCallback` dep array and
// referential-identity assumption downstream is unchanged — only the container
// they arrive in is different.
//
// This interface is the union of all three sources, and adding a field means
// adding it in exactly one of them:
//   - StoreRuntime  — the cross-slice refs (store/runtime.ts)
//   - XxxSlice      — what each slice publishes back (store/slices/*)
//   - the block below — the provider's own useState + boot helpers
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ConnState, GatewayWs } from '../services/gateway-ws';
import type { AgentProfile } from './types';
import type { UiMessage } from '../utils/messages';
import type { StoreRuntime } from './runtime';

import type { AskInboxSlice } from './slices/useAskInbox';
import type { AskRepliesSlice } from './slices/useAskReplies';
import type { CommandsSlice } from './slices/useCommands';
import type { ComposerSlice } from './slices/useComposer';
import type { ConnectionSlice } from './slices/useConnection';
import type { GatewaySlice } from './slices/useGateway';
import type { LiveRosterSlice } from './slices/useLiveRoster';
import type { LiveSessionsSlice } from './slices/useLiveSessions';
import type { LiveTurnSlice } from './slices/useLiveTurn';
import type { ModelsSlice } from './slices/useModels';
import type { NotificationsSlice } from './slices/useNotifications';
import type { ProfileOpsSlice } from './slices/useProfileOps';
import type { QueueSlice } from './slices/useQueue';
import type { SessionInfoSlice } from './slices/useSessionInfo';
import type { SessionMiscSlice } from './slices/useSessionMisc';
import type { SessionOpsSlice } from './slices/useSessionOps';
import type { SessionsSlice } from './slices/useSessions';
import type { ThemeSlice } from './slices/useTheme';
import type { ToolRefreshSlice } from './slices/useToolRefresh';
import type { TurnSlice } from './slices/useTurn';

/** Live host/username/profile/sessionKey, for callbacks frozen in openWs. */
export type LatestRef = MutableRefObject<{
  host: string;
  username: string;
  activeProfile: string;
  sessionKey: string | null;
}>;

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface StoreCtx
  extends
    StoreRuntime,
    // ── published by the slices ──
    AskInboxSlice,
    AskRepliesSlice,
    CommandsSlice,
    ComposerSlice,
    ConnectionSlice,
    GatewaySlice,
    LiveRosterSlice,
    LiveSessionsSlice,
    LiveTurnSlice,
    ModelsSlice,
    NotificationsSlice,
    ProfileOpsSlice,
    QueueSlice,
    SessionInfoSlice,
    SessionMiscSlice,
    SessionOpsSlice,
    SessionsSlice,
    ThemeSlice,
    ToolRefreshSlice,
    TurnSlice {
  // ── the provider's own state ──
  host: string;
  setHost: Setter<string>;
  username: string;
  setUsername: Setter<string>;
  password: string;
  setPassword: Setter<string>;
  booting: boolean;
  setBooting: Setter<boolean>;
  busy: boolean;
  setBusy: Setter<boolean>;
  error: string | null;
  setError: Setter<string | null>;
  conn: ConnState;
  setConn: Setter<ConnState>;
  activeProfile: string;
  setActiveProfile: Setter<string>;
  profiles: AgentProfile[];
  setProfiles: Setter<AgentProfile[]>;
  authed: boolean;
  setAuthed: Setter<boolean>;
  openingId: string | null;
  setOpeningId: Setter<string | null>;
  sessionId: string | null;
  setSessionId: Setter<string | null>;
  /** stored DB id — stable across resumes, unlike sessionId */
  sessionKey: string | null;
  setSessionKey: Setter<string | null>;
  sessionTitle: string;
  setSessionTitle: Setter<string>;
  messages: UiMessage[];
  setMessages: Setter<UiMessage[]>;
  historyLoadingMore: boolean;
  setHistoryLoadingMore: Setter<boolean>;
  historyExhausted: boolean;
  setHistoryExhausted: Setter<boolean>;
  trimmedOlder: number;
  setTrimmedOlder: Setter<number>;
  generating: boolean;
  setGenerating: Setter<boolean>;
  toolLine: string | null;
  setToolLine: Setter<string | null>;
  editingRowId: number | null;
  setEditingRowId: Setter<number | null>;

  // ── the provider's cross-cutting helpers ──
  latest: LatestRef;
  /** Adopt a rotated session cookie, but only if the auth scope still matches. */
  acceptRotatedCookie: (
    nextCookie: string,
    host: string,
    username: string,
    connectionEpoch: number,
    profileEpoch: number,
  ) => Promise<void>;
  refreshProfiles: () => Promise<void>;
  hydrateSessionContext: (gateway: GatewayWs, sessionId: string) => void;
  noteHistoryWindow: (limit: number, exhausted: boolean) => void;
  resetHistoryWindow: () => void;
  /** Validate a stored cookie or trade the password for a fresh session cookie. */
  ensureCookie: (host: string, username: string, password: string, isCurrent?: () => boolean) => Promise<string>;
}
