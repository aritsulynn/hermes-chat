// Tool-result fill slice — pulls tool results/diffs from the REST transcript so
// expanded tool bubbles resolve without waiting for the turn to end, and
// debounces the refresh after each `tool.complete`.
import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { inlineDiffFromDetail } from '../../utils/diff';
import { connectionScope } from '../../services/connection';
import { getSessionMessages } from '../../services/dashboard';
import { formatToolResult } from '../../utils/toolResult';
import type { UiMessage } from '../../utils/messages';
import type { StoreRuntime } from '../runtime';

type LatestRef = MutableRefObject<{ host: string; username: string; activeProfile: string; sessionKey: string | null }>;

export interface ToolRefreshSliceDeps {
  runtime: StoreRuntime;
  latest: LatestRef;
  acceptRotatedCookie: (
    nextCookie: string,
    host: string,
    username: string,
    connectionEpoch: number,
    profileEpoch: number,
  ) => Promise<void>;
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
}

export interface ToolRefreshSlice {
  toolRefreshRef: MutableRefObject<() => void>;
  scheduleToolRefresh: () => void;
  refreshToolResults: () => void;
}

export function useToolRefreshSlice({
  runtime,
  latest,
  acceptRotatedCookie,
  setMessages,
}: ToolRefreshSliceDeps): ToolRefreshSlice {
  const { cookie, messagesRef, activeProfileRef, profileEpochRef, connectionEpochRef } = runtime;
  const toolRefreshRef = useRef<() => void>(() => {});
  const toolRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tool RESULT fill from the REST transcript. The gateway's history projection
  // deliberately omits tool results (`name` + 80-char `context` + `args` only —
  // tui_gateway/session_history.py::_history_to_messages), and the live
  // `tool.complete` may predate the `result` field, so filling from REST is the
  // dependable path. Name-aware tail alignment keeps a shifted transcript from
  // pasting another call's result.
  toolRefreshRef.current = () => {
    const h = latest.current.host;
    const profile = latest.current.activeProfile;
    const epoch = profileEpochRef.current;
    const sk = latest.current.sessionKey;
    const connectionEpoch = connectionEpochRef.current;
    const targetUser = latest.current.username;
    const ck = cookie.current;
    // Web: the jar is empty (Set-Cookie is unreadable) but the browser cookie
    // still rides along via credentials:'include', so only host+key are required.
    if (!h || !sk) return;
    void (async () => {
      try {
        const items = await getSessionMessages(
          h,
          ck,
          sk,
          profile,
          200,
          connectionScope(h, targetUser),
          async (nextCookie) => acceptRotatedCookie(nextCookie, h, targetUser, connectionEpoch, epoch),
        );
        if (
          activeProfileRef.current !== profile ||
          profileEpochRef.current !== epoch ||
          connectionEpochRef.current !== connectionEpoch ||
          latest.current.sessionKey !== sk
        )
          return;
        const restTools = items.filter((m) => m.role === 'tool' && m.content.trim());
        const liveTools = messagesRef.current.filter((m) => m.role === 'tool');
        if (restTools.length === 0 || liveTools.length === 0) return;
        const fill = new Map<string, { output?: string; diff?: string; command?: string }>();
        const used = new Set<number>();
        let r = Math.max(0, restTools.length - liveTools.length);
        for (const live of liveTools) {
          if (live.output && live.diff && live.command) continue; // already complete
          const want = live.text;
          let j = -1;
          for (let k = r; k < restTools.length && k < r + 4; k++) {
            if (!used.has(k) && want && restTools[k].name === want) {
              j = k;
              break;
            }
          }
          if (j === -1 && r < restTools.length && !used.has(r)) j = r;
          if (j === -1) continue;
          used.add(j);
          r = Math.max(r, j + 1);
          const output = formatToolResult(restTools[j].content) || undefined;
          const diff = inlineDiffFromDetail(restTools[j].content) || undefined;
          const command = restTools[j].command || undefined;
          if (output || diff || command) {
            fill.set(live.id, {
              ...(output ? { output } : {}),
              ...(diff ? { diff } : {}),
              ...(command && !live.command ? { command } : {}),
            });
          }
        }
        if (fill.size === 0) return;
        setMessages((prev) =>
          prev.map((m) => {
            const f = fill.get(m.id);
            return f ? { ...m, ...f } : m;
          }),
        );
      } catch {}
    })();
  };

  // Debounced refresh after each tool.complete so a live turn fills in results
  // (and diffs) without waiting for the whole turn to end.
  const scheduleToolRefresh = () => {
    if (toolRefreshTimer.current) clearTimeout(toolRefreshTimer.current);
    toolRefreshTimer.current = setTimeout(() => toolRefreshRef.current(), 700);
  };
  /** On-demand REST fill (the chat screen calls this when a tool bubble is
   *  expanded before the turn ended / on a backend without live results). */
  const refreshToolResults = useCallback(() => toolRefreshRef.current(), []);

  // Cleanup the debounce timer on unmount so it can't fire late.
  useEffect(
    () => () => {
      if (toolRefreshTimer.current) clearTimeout(toolRefreshTimer.current);
    },
    [],
  );

  return { toolRefreshRef, scheduleToolRefresh, refreshToolResults };
}
