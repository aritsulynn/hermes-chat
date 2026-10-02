// Session-list slice — the recents list (fetch/refresh/load-more) and its
// paging state. Setters/refs are returned because logout, profile switch and
// delete also mutate the list.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { errMsg } from '../../utils/messages';
import type { ScopedSessionSummary } from '../types';
import type { StoreCtx } from '../ctx';

export interface SessionsSlice {
  sessions: ScopedSessionSummary[];
  setSessions: Dispatch<SetStateAction<ScopedSessionSummary[]>>;
  sessionsLimit: number;
  setSessionsLimit: Dispatch<SetStateAction<number>>;
  sessionsHasMore: boolean;
  setSessionsHasMore: Dispatch<SetStateAction<boolean>>;
  sessionsLoadingMore: boolean;
  setSessionsLoadingMore: Dispatch<SetStateAction<boolean>>;
  sessionsLimitRef: MutableRefObject<number>;
  sessionsHasMoreRef: MutableRefObject<boolean>;
  sessionsLoadingMoreRef: MutableRefObject<boolean>;
  sessionsFetchRef: MutableRefObject<Promise<ScopedSessionSummary[]> | null>;
  sessionsFetchProfileRef: MutableRefObject<string | null>;
  refreshSessions: (limit?: number) => Promise<ScopedSessionSummary[]>;
  loadMoreSessions: () => Promise<ScopedSessionSummary[]>;
}

export function useSessionsSlice({ setError, gw, activeProfileRef, profileEpochRef }: StoreCtx): SessionsSlice {
  const [sessions, setSessions] = useState<ScopedSessionSummary[]>([]);
  const [sessionsLimit, setSessionsLimit] = useState(100);
  const [sessionsHasMore, setSessionsHasMore] = useState(true);
  const [sessionsLoadingMore, setSessionsLoadingMore] = useState(false);
  const sessionsLimitRef = useRef(100);
  sessionsLimitRef.current = sessionsLimit;
  const sessionsHasMoreRef = useRef(true);
  sessionsHasMoreRef.current = sessionsHasMore;
  const sessionsLoadingMoreRef = useRef(false);
  const sessionsFetchRef = useRef<Promise<ScopedSessionSummary[]> | null>(null);
  const sessionsFetchProfileRef = useRef<string | null>(null);

  const refreshSessions = useCallback(async (limit?: number): Promise<ScopedSessionSummary[]> => {
    const g = gw.current;
    if (!g) return [];
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    // Default to the current known depth so a drawer reopen doesn't shrink
    // back to 100 after the user already scrolled deeper.
    const want = limit ?? sessionsLimitRef.current ?? 100;
    // Concurrent scroll-bottom + drawer-open refreshes share one request, but
    // a profile switch always starts a separate request for the new scope.
    if (sessionsFetchRef.current && sessionsFetchProfileRef.current === profile) {
      return sessionsFetchRef.current;
    }
    sessionsFetchRef.current = null;
    sessionsFetchProfileRef.current = null;
    let p: Promise<ScopedSessionSummary[]> | null = null;
    p = (async () => {
      try {
        const rows = await g.listSessions(want, profile);
        const s: ScopedSessionSummary[] = rows.map((row) => ({
          ...row,
          profile: (row as ScopedSessionSummary).profile ?? profile,
        }));
        if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return [];
        setSessions(s);
        setSessionsLimit(want);
        // session.list returns newest-first up to limit — a full page means
        // there may be older chats still on the server.
        setSessionsHasMore(s.length >= want);
        return s;
      } catch (e) {
        if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
          setError(errMsg(e));
        }
        return [];
      } finally {
        if (sessionsFetchRef.current === p) {
          sessionsFetchRef.current = null;
          sessionsFetchProfileRef.current = null;
        }
      }
    })();
    sessionsFetchRef.current = p;
    sessionsFetchProfileRef.current = profile;
    return p;
  }, []);

  const loadMoreSessions = useCallback(async (): Promise<ScopedSessionSummary[]> => {
    if (sessionsLoadingMoreRef.current || !sessionsHasMoreRef.current) return [];
    const g = gw.current;
    if (!g) return [];
    const profile = activeProfileRef.current;
    const epoch = profileEpochRef.current;
    sessionsLoadingMoreRef.current = true;
    setSessionsLoadingMore(true);
    const want = Math.min((sessionsLimitRef.current ?? 100) + 100, 1000);
    try {
      const rows = await g.listSessions(want, profile);
      if (activeProfileRef.current !== profile || profileEpochRef.current !== epoch) return [];
      const s: ScopedSessionSummary[] = rows.map((row) => ({
        ...row,
        profile: (row as ScopedSessionSummary).profile ?? profile,
      }));
      setSessions(s);
      setSessionsLimit(want);
      setSessionsHasMore(s.length >= want && want < 1000);
      return s;
    } catch (e) {
      if (activeProfileRef.current === profile && profileEpochRef.current === epoch) {
        setError(errMsg(e));
      }
      return [];
    } finally {
      sessionsLoadingMoreRef.current = false;
      setSessionsLoadingMore(false);
    }
  }, []);

  return {
    sessions,
    setSessions,
    sessionsLimit,
    setSessionsLimit,
    sessionsHasMore,
    setSessionsHasMore,
    sessionsLoadingMore,
    setSessionsLoadingMore,
    sessionsLimitRef,
    sessionsHasMoreRef,
    sessionsLoadingMoreRef,
    sessionsFetchRef,
    sessionsFetchProfileRef,
    refreshSessions,
    loadMoreSessions,
  };
}
