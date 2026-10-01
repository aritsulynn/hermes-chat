// Live-turn slice — the streaming buffer and the per-session live-turn latches
// (which room owns the running turn), plus the park/reanchor helpers used when
// navigating or rebuilding the transcript.
import { useCallback, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { nid } from '../../utils/messages';
import type { UiMessage } from '../../utils/messages';
import { profileSessionKey } from '../helpers';
import type { StoreCtx } from '../ctx';

export interface LiveTurnSlice {
  streamingTexts: Record<string, string>;
  setStreamingTexts: Dispatch<SetStateAction<Record<string, string>>>;
  streamingRef: MutableRefObject<Record<string, string>>;
  liveAid: MutableRefObject<string | null>;
  liveThinkAid: MutableRefObject<string | null>;
  liveTools: MutableRefObject<Map<string, string>>;
  liveToolAid: MutableRefObject<string | null>;
  liveTurnTools: MutableRefObject<string[]>;
  liveTurnDiffs: MutableRefObject<string[]>;
  turnOwnerRef: MutableRefObject<Map<string, string>>;
  parkedLiveRef: MutableRefObject<Set<string>>;
  lastTurnEventAt: MutableRefObject<number>;
  clearStreaming: () => void;
  parkLiveTurn: () => void;
  reanchorLiveTurn: (items: UiMessage[]) => UiMessage[];
}

export function useLiveTurnSlice({ latest, sessionIdRef, generatingRef, runtimeOwners }: StoreCtx): LiveTurnSlice {
  const [streamingTexts, setStreamingTexts] = useState<Record<string, string>>({});
  const streamingRef = useRef<Record<string, string>>({});
  streamingRef.current = streamingTexts;
  const liveAid = useRef<string | null>(null);
  const liveThinkAid = useRef<string | null>(null);
  const liveTools = useRef<Map<string, string>>(new Map());
  const liveToolAid = useRef<string | null>(null);
  const liveTurnTools = useRef<string[]>([]); // tool bubbles minted this turn, in order
  const liveTurnDiffs = useRef<string[]>([]); // inline diffs seen this turn (for the end-of-turn summary)
  // Live turns are per-session: the latch must follow the room, not the app.
  // parkedLive = stored keys with a background-live turn; turnOwner maps each
  // live runtime sid to its stored key so a background complete cleans up.
  const turnOwnerRef = useRef<Map<string, string>>(new Map());
  const parkedLiveRef = useRef<Set<string>>(new Set());
  // Last turn-event time — the watchdog below releases a stranded Stop latch.
  const lastTurnEventAt = useRef(0);

  const clearStreaming = useCallback(() => {
    streamingRef.current = {};
    setStreamingTexts((prev) => (Object.keys(prev).length ? {} : prev));
  }, []);
  // Park the visible room's live turn before leaving it, so coming back can
  // restore its Stop button instead of stranding Send/Stop on the wrong room.
  const parkLiveTurn = useCallback(() => {
    if (!generatingRef.current) return;
    const profile = latest.current.activeProfile;
    const stored = latest.current.sessionKey;
    const runtimeSid = sessionIdRef.current;
    const owner = stored
      ? profileSessionKey(profile, stored)
      : runtimeSid
        ? (runtimeOwners.current.get(runtimeSid) ?? profileSessionKey(profile, runtimeSid))
        : null;
    if (owner) parkedLiveRef.current.add(owner);
  }, []);
  // Re-anchor streaming after a transcript rebuild while this room's turn is
  // live (REST is newer truth; the pre-switch buffer was already dropped).
  const reanchorLiveTurn = useCallback((items: UiMessage[]): UiMessage[] => {
    const tail = items[items.length - 1];
    if (tail && tail.role === 'assistant') {
      liveAid.current = tail.id;
      return items;
    }
    const rea = nid();
    liveAid.current = rea;
    return [...items, { id: rea, role: 'assistant', text: '', pending: true }];
  }, []);

  return {
    streamingTexts,
    setStreamingTexts,
    streamingRef,
    liveAid,
    liveThinkAid,
    liveTools,
    liveToolAid,
    liveTurnTools,
    liveTurnDiffs,
    turnOwnerRef,
    parkedLiveRef,
    lastTurnEventAt,
    clearStreaming,
    parkLiveTurn,
    reanchorLiveTurn,
  };
}
