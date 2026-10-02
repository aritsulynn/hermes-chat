// Session details / usage slice — the live usage strip the composer and the
// header's context ring read. The setters are returned because WS event handlers
// and session open/resume/branch also write usageInfo/sessionInfo.
import { useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { mergeUsageState } from '../helpers';
import type { StoreCtx } from '../ctx';
import type { SessionInfo, UsageInfo } from '../types';

export interface SessionInfoSlice {
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  usageInfo: UsageInfo | null;
  setUsageInfo: Dispatch<SetStateAction<UsageInfo | null>>;
  /** Refresh the composer status strip at each turn end. */
  usageRefreshRef: MutableRefObject<() => void>;
}

export function useSessionInfoSlice({ sessionId, sessionIdRef, gw }: StoreCtx): SessionInfoSlice {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);

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
        if (sessionIdRef.current === sid) setUsageInfo((prev) => mergeUsageState(prev, info));
      })
      .catch((e: unknown) => {
        console.warn('[session-info] usage refresh failed', e);
      });
  };

  return {
    sessionInfo,
    setSessionInfo,
    usageInfo,
    setUsageInfo,
    usageRefreshRef,
  };
}
