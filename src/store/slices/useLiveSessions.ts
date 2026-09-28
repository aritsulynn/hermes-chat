// Live-session slice — which stored sessions the gateway currently has work
// running in, polled from `session.active_list`.
//
// Why poll instead of watching events: the gateway pushes token/tool/complete
// events only for the session a client has attached to, so a turn running in
// another session is invisible from here. `session.active_list` is the one RPC
// that reports the whole live set, and the store already calls it (see
// useGateway's probeWorkingSessions) to settle reconnect latches — this slice
// keeps the answer around instead of throwing it away.
//
// `active_list` rows are keyed by RUNTIME session id, while the drawer's recents
// are STORED ids (session.list). They are bridged by `runtimeOwners`, which the
// WS handlers fill as sessions are resumed; a row with no owner is a session
// from a profile this client never opened, and is left unmapped rather than
// guessed at.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { profileSessionKey } from '../helpers';
import { isLiveStatus } from '../live-sessions';
import type { LiveSessionMap, LiveStatus } from '../live-sessions';
import type { StoreCtx } from '../ctx';

export type { LiveSessionMap, LiveStatus } from '../live-sessions';

export interface LiveSessionsSlice {
  liveSessions: LiveSessionMap;
  /** True once a poll has succeeded — lets a surface tell "idle" from "unknown". */
  liveSessionsKnown: boolean;
  refreshLiveSessions: () => Promise<void>;
}

export function useLiveSessionsSlice({ gw, runtimeOwners, activeProfileRef, profileEpochRef }: StoreCtx): LiveSessionsSlice {
  const [liveSessions, setLiveSessions] = useState<LiveSessionMap>({});
  const [liveSessionsKnown, setLiveSessionsKnown] = useState(false);
  // A ref, not state: the poll loop reads it on every tick, and a state write
  // here would tear down and rebuild the interval mid-cycle.
  const armed = useRef(false);

  const refreshLiveSessions = useCallback(async () => {
    const g = gw.current;
    if (!g || !armed.current) return;
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    try {
      const rows = await g.activeList();
      if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return;
      const next: Record<string, LiveStatus> = {};
      for (const row of rows) {
        if (!row.id || !isLiveStatus(row.status)) continue;
        // Same bridge the reconnect reconcile uses: a known runtime owner wins,
        // and a row that names its profile can be keyed directly. Anything else
        // belongs to a profile we cannot name, so it stays unmapped.
        const owner =
          runtimeOwners.current.get(row.id) ??
          (row.profile ? profileSessionKey(row.profile, row.sessionKey || row.id) : '');
        if (!owner) continue;
        next[owner] = row.status;
      }
      setLiveSessions(next);
      setLiveSessionsKnown(true);
    } catch {
      // Older gateways have no session.active_list, and a poll racing a socket
      // drop fails the same way. Either way the last good answer still stands;
      // only a first-load failure leaves `liveSessionsKnown` false.
    }
  }, [activeProfileRef, profileEpochRef, runtimeOwners, gw]);

  useEffect(() => {
    // Poll only while the app is in front of the user: a backgrounded app has
    // no row on screen to animate, and a foreground interval is real battery
    // cost on a phone. 'inactive' still counts as visible (iOS hands it over
    // during the app-switcher snapshot).
    let timer: ReturnType<typeof setInterval> | null = null;
    const stop = () => {
      armed.current = false;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (armed.current) return;
      armed.current = true;
      void refreshLiveSessions();
      // 4s: fast enough that a turn started elsewhere appears while the drawer
      // is still open, slow enough to sit beside the 3.5s subagent poll the chat
      // screen already runs.
      timer = setInterval(() => void refreshLiveSessions(), 4000);
    };
    const sync = () => {
      if (AppState.currentState === 'background' || AppState.currentState === 'inactive') stop();
      else start();
    };
    sync();
    const sub = AppState.addEventListener('change', sync);
    return () => {
      sub.remove();
      stop();
    };
  }, [refreshLiveSessions]);

  return { liveSessions, liveSessionsKnown, refreshLiveSessions };
}
