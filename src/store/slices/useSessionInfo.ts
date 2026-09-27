// Session details / usage slice — the Info sheet state, the live usage strip,
// and the openInfo fetch. The setters are returned because WS event handlers
// and session open/resume/branch also write usageInfo/sessionInfo.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { errMsg } from '../../utils/messages';
import { mergeUsageState } from '../helpers';
import type { StoreRuntime } from '../runtime';
import type { SessionInfo, UsageInfo } from '../types';

export interface SessionInfoSliceDeps {
  runtime: StoreRuntime;
  activeProfile: string;
  sessionId: string | null;
  sessionIdRef: MutableRefObject<string | null>;
}

export interface SessionInfoSlice {
  infoOpen: boolean;
  setInfoOpen: Dispatch<SetStateAction<boolean>>;
  infoSeq: number;
  setInfoSeq: Dispatch<SetStateAction<number>>;
  sessionInfo: SessionInfo | null;
  setSessionInfo: Dispatch<SetStateAction<SessionInfo | null>>;
  usageInfo: UsageInfo | null;
  setUsageInfo: Dispatch<SetStateAction<UsageInfo | null>>;
  usageLoading: boolean;
  setUsageLoading: Dispatch<SetStateAction<boolean>>;
  /** Refresh the composer status strip at each turn end. */
  usageRefreshRef: MutableRefObject<() => void>;
  openInfo: () => Promise<void>;
}

export function useSessionInfoSlice({
  runtime,
  activeProfile,
  sessionId,
  sessionIdRef,
}: SessionInfoSliceDeps): SessionInfoSlice {
  const { gw, activeProfileRef, profileEpochRef } = runtime;
  const [infoOpen, setInfoOpen] = useState(false);
  // Monotonic open requests — a boolean edge can get stuck `true` (e.g. a
  // present that never resolved), which would swallow every later tap because
  // the effect below only fires on change. A counter refires every time.
  const [infoSeq, setInfoSeq] = useState(0);
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

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

  const openInfo = useCallback(async () => {
    setInfoOpen(true);
    setInfoSeq((s) => s + 1);
    const g = gw.current;
    const sid = sessionId;
    const profile = activeProfile;
    const epoch = profileEpochRef.current;
    if (!g || !sid) return;
    setUsageLoading(true);
    try {
      const info = await g.usage(sid);
      if (sessionIdRef.current === sid) setUsageInfo((prev) => mergeUsageState(prev, info));
    } catch (e) {
      if (sessionIdRef.current === sid) setUsageInfo({ error: errMsg(e) });
    } finally {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
        setUsageLoading(false);
      }
    }
  }, [activeProfile, sessionId]);

  return {
    infoOpen,
    setInfoOpen,
    infoSeq,
    setInfoSeq,
    sessionInfo,
    setSessionInfo,
    usageInfo,
    setUsageInfo,
    usageLoading,
    setUsageLoading,
    usageRefreshRef,
    openInfo,
  };
}
