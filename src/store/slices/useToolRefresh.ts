// Tool-result fill slice — pulls tool results/diffs from the REST transcript so
// expanded tool bubbles resolve without waiting for the turn to end, and
// debounces the refresh after each `tool.complete`.
import { useCallback, useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { inlineDiffFromDetail } from '../../utils/diff';
import { missingHistoryTools, pairThinkingText, rebuildTurnTimeline } from '../../utils/messages';
import { connectionScope } from '../../services/connection';
import { CHAT_HISTORY_REFRESH } from '../../services/constants';
import { getSessionMessages } from '../../services/dashboard';
import { formatToolResult } from '../../utils/toolResult';
import { historyToItems } from '../helpers';
import type { StoreCtx } from '../ctx';

export interface ToolRefreshSlice {
  toolRefreshRef: MutableRefObject<() => void>;
  scheduleToolRefresh: () => void;
  refreshToolResults: () => void;
}

export function useToolRefreshSlice({
  latest,
  acceptRotatedCookie,
  setMessages,
  cookie,
  messagesRef,
  activeProfileRef,
  profileEpochRef,
  connectionEpochRef,
  trimmedOlder,
  historyExhausted,
  generatingRef,
}: StoreCtx): ToolRefreshSlice {
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
    // Placement anchor for bubbles this fetch inserts (see below): the last
    // assistant row right now — the pending bubble mid-turn, the completed
    // answer after it. Captured synchronously: a queued drain may start the
    // next turn before the fetch returns. Same for the intact-window flag:
    // with zero live tool bubbles, history tools are only safely "missing"
    // when nothing was ever trimmed or paged out.
    const anchorId = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')?.id ?? null;
    const intactWindow = trimmedOlder === 0 && historyExhausted;
    void (async () => {
      try {
        const items = await getSessionMessages(
          h,
          ck,
          sk,
          profile,
          CHAT_HISTORY_REFRESH,
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
        const fill = new Map<string, { output?: string; diff?: string; command?: string }>();
        if (restTools.length > 0 && liveTools.length > 0) {
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
            const output = formatToolResult(restTools[j].content, restTools[j].name) || undefined;
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
        }
        // Insert the calls a turn made that never arrived as live `tool.*`
        // events (some gateways only persist them to history): trailing
        // history tool rows with no live bubble, placed before the anchor so
        // they land inside their own turn even if the next one already started.
        // Without an anchor the placement is unknowable — fill only.
        const histItems = anchorId != null ? historyToItems(items) : [];
        const missing =
          anchorId != null ? missingHistoryTools(histItems, messagesRef.current, intactWindow) : [];
        // Settle thinking to the persisted reasoning sidecar. Two jobs, both only
        // once the turn has stopped (mid-turn history has nothing newer):
        //   - rebuild the turn's Thought rows from the durable sidecar (the live
        //     stream can differ in count/slot, or be absent — see
        //     rebuildTurnTimeline);
        //   - overwrite any bubble the rebuild left in place with the persisted
        //     text.
        const settle = !generatingRef.current && histItems.length > 0;
        const hasInsert = settle && rebuildTurnTimeline(messagesRef.current, histItems) !== messagesRef.current;
        const thinkSync = settle ? pairThinkingText(histItems, messagesRef.current) : [];
        if (fill.size === 0 && missing.length === 0 && thinkSync.length === 0 && !hasInsert) return;
        const thinkById = new Map(thinkSync.map((t) => [t.id, t.text] as const));
        setMessages((prev) => {
          const base = hasInsert ? rebuildTurnTimeline(prev, histItems) : prev;
          const next = base.map((m) => {
            const f = fill.get(m.id);
            const t = thinkById.get(m.id);
            return f || t !== undefined ? { ...m, ...(f ?? {}), ...(t !== undefined ? { text: t } : {}) } : m;
          });
          if (missing.length === 0) return next;
          const idx = next.findIndex((m) => m.id === anchorId);
          if (idx < 0) return next;
          return [...next.slice(0, idx), ...missing, ...next.slice(idx)];
        });
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
