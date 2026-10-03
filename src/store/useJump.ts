// Jump-to-prompt: reaching any point in a long session.
//
// ── Why this exists ──────────────────────────────────────────────────────────
// The transcript endpoint has no cursor — only `order + limit` — so the chat
// pages history by growing a tail limit and giving up at CHAT_HISTORY_MAX_ROWS
// (1200). On a longer session the UI reports "no more history" with thousands of
// rows still on the server, and the user reads that as data loss.
//
// The gateway exposes two cursor-based endpoints (roadmap §4.7):
//
//   GET /timeline                  every human prompt as metadata only — row_id,
//                                  a <=120 char preview, a timestamp. No tool
//                                  payloads, no assistant text, so a 10k-message
//                                  session's index pages cheaply.
//   GET /messages/around?row_id=   one bounded display page anchored at an exact
//                                  prompt. ~120 rows however deep the anchor is.
//
// ── Paging is driven by the index, not by arithmetic ─────────────────────────
// `/messages/around` only accepts an anchor that IS a human prompt: the server
// looks the row up with `role='user'` and a non-empty prompt preview, and 404s
// otherwise (see `get_session_messages_around`). So "the next page" is not
// `limit + 120` — it is the next prompt row id in the index. Every prompt row
// carries its rowId through `historyToItems`, and the index lists them all, so
// older/newer are an index lookup either way.
//
// This also means paging without a loaded index cannot work, and says so rather
// than silently fetching the same page again.
//
// ── The invariant that matters ───────────────────────────────────────────────
// After a jump, `messages` holds the jumped window and nothing else. The tail is
// still on the server and reachable again via backToTail; it is not kept
// resident. `atTail` is state the chat screen renders against, because anything
// that assumed `messages` was always the tail would quietly break.
import { useCallback, useRef, useState } from 'react';

import { AnchorNotFoundError, getSessionMessagesAround, getSessionTimeline } from '../services/dashboard';
import type { AroundPagination } from '../services/dashboard';
import { historyToItems } from './helpers';
import { buildTimelineIndex, mergeTimelinePage } from '../utils/session-timeline';
import type { TimelineIndex } from '../utils/session-timeline';
import { errMsg } from '../utils/messages';
import type { UiMessage } from '../utils/messages';

export interface JumpSlice {
  /** Prompt index for the open session; null until first loaded. */
  index: TimelineIndex | null;
  indexLoading: boolean;
  indexError: string | null;
  indexExhausted: boolean;
  loadIndex: (opts?: { append?: boolean }) => Promise<void>;

  /** True while the transcript window is the session tail. */
  atTail: boolean;
  /** Where the jumped window sits, for the chat header. */
  jumpAt: AroundPagination | null;
  jumping: boolean;
  jumpError: string | null;
  jumpTo: (rowId: number) => Promise<boolean>;
  jumpOlder: () => Promise<boolean>;
  jumpNewer: () => Promise<boolean>;
  /** True when a jump can page further in each direction. */
  canJumpOlder: boolean;
  canJumpNewer: boolean;
  /** Drop the jumped window and restore the session tail. */
  backToTail: () => Promise<void>;
  clearJump: () => void;
}

export interface JumpCtx {
  host: string;
  activeProfile: string;
  sessionKey: string | null;
  cookie: React.MutableRefObject<string>;
  profileEpochRef: React.MutableRefObject<number>;
  connectionEpochRef: React.MutableRefObject<number>;
  setMessages: (fn: (prev: UiMessage[]) => UiMessage[]) => void;
  /** Re-fetch the tail window from scratch — restores the transcript after a
   *  jump, and after a rewind or a new turn. */
  refreshTail: () => Promise<void>;
}

/** Rows per jumped page. The server caps /messages/around at 120, so this is
 *  also the ceiling — one page is as much as one fetch can return. */
const PAGE_LIMIT = 120;

export function useJumpSlice(ctx: JumpCtx): JumpSlice {
  const [index, setIndex] = useState<TimelineIndex | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [atTail, setAtTail] = useState(true);
  const [jumpAt, setJumpAt] = useState<AroundPagination | null>(null);
  const [jumping, setJumping] = useState(false);
  const [jumpError, setJumpError] = useState<string | null>(null);
  // A jump in flight must not paint over whatever replaced it — another jump, a
  // session switch, or the tail. Same reason the transcript fetches compare the
  // scope; this also has to survive an unmount mid-fetch.
  const jumpToken = useRef(0);
  // Identity-stable on purpose: it reads the two epoch refs, so it never needs
  // to be a dependency and every callback below can leave it out of its dep
  // array. Same pattern as `getAuthScope` in the store.
  const scope = useCallback(
    () => `${ctxRef.current.connectionEpochRef.current}:${ctxRef.current.profileEpochRef.current}`,
    [],
  );
  // Everything below reads refs the store mutates during render, so these
  // callbacks take no state deps and cannot go stale.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  // Same for the two pieces of state the paging helpers read.
  const indexRef = useRef<TimelineIndex | null>(null);
  indexRef.current = index;
  const jumpAtRef = useRef<AroundPagination | null>(null);
  jumpAtRef.current = jumpAt;

  const loadIndex = useCallback(
    async (opts: { append?: boolean } = {}) => {
      const { host: h, activeProfile: profile, sessionKey: sk } = ctxRef.current;
      if (!h || !sk) return;
      if (opts.append) {
        const cur = indexRef.current;
        if (!cur || cur.cursor == null || cur.hasMore === false) return;
      }
      const epoch = scope();
      setIndexLoading(true);
      if (!opts.append) setIndexError(null);
      try {
        const raw = await getSessionTimeline(h, ctxRef.current.cookie.current, sk, {
          afterRowId: opts.append ? (indexRef.current?.cursor ?? 0) : 0,
          limit: 200,
          profile,
        });
        if (scope() !== epoch || ctxRef.current.sessionKey !== sk) return;
        const page = buildTimelineIndex(raw);
        setIndex((prev) => (opts.append && prev ? mergeTimelinePage(prev, page) : page));
      } catch (e) {
        if (scope() === epoch && ctxRef.current.sessionKey === sk) setIndexError(errMsg(e));
      } finally {
        if (scope() === epoch && ctxRef.current.sessionKey === sk) setIndexLoading(false);
      }
    },
    [scope],
  );

  /** Fetch the page anchored at an exact prompt row. */
  const fetchAround = useCallback(async (rowId: number) => {
    const { host: h, activeProfile: profile, sessionKey: sk, cookie } = ctxRef.current;
    if (!h || !sk) return null;
    return getSessionMessagesAround(h, cookie.current, sk, rowId, { limit: PAGE_LIMIT, profile });
  }, []);

  const jumpTo = useCallback(
    async (rowId: number): Promise<boolean> => {
      const sk = ctxRef.current.sessionKey;
      if (!sk) return false;
      const epoch = scope();
      const token = ++jumpToken.current;
      setJumping(true);
      setJumpError(null);
      try {
        const page = await fetchAround(rowId);
        if (!page || scope() !== epoch || jumpToken.current !== token || ctxRef.current.sessionKey !== sk) return false;
        // The whole window is replaced — that is the point. See the invariant
        // note at the top of this file.
        ctxRef.current.setMessages(() => historyToItems(page.items as never));
        setJumpAt(page.pagination);
        setAtTail(false);
        return true;
      } catch (e) {
        if (scope() === epoch && jumpToken.current === token) {
          // A rewound or hidden prompt is not something the user can act on, so
          // say where it went instead of surfacing a raw 404.
          setJumpError(
            e instanceof AnchorNotFoundError ? 'That message is no longer in this conversation.' : errMsg(e),
          );
        }
        return false;
      } finally {
        if (scope() === epoch && jumpToken.current === token) setJumping(false);
      }
    },
    [fetchAround, scope],
  );

  // The next anchor in each direction is the neighbouring prompt in the index.
  const neighbour = useCallback((direction: 'older' | 'newer'): number | null => {
    const cur = indexRef.current;
    const at = jumpAtRef.current;
    if (!cur || !at) return null;
    const rows = cur.entries.map((e) => e.rowId);
    const i = rows.indexOf(at.rowId);
    if (i < 0) return null;
    const next = direction === 'older' ? rows[i - 1] : rows[i + 1];
    return next ?? null;
  }, []);

  const canJumpOlder = atTail === false && neighbour('older') != null;
  const canJumpNewer = atTail === false && neighbour('newer') != null;

  const jumpOlder = useCallback(() => {
    const rowId = neighbour('older');
    return rowId == null ? Promise.resolve(false) : jumpTo(rowId);
  }, [jumpTo, neighbour]);

  const jumpNewer = useCallback(() => {
    const rowId = neighbour('newer');
    if (rowId == null) return Promise.resolve(false);
    return jumpTo(rowId);
  }, [jumpTo, neighbour]);

  const backToTail = useCallback(async () => {
    const epoch = scope();
    ++jumpToken.current;
    setJumping(true);
    try {
      await ctxRef.current.refreshTail();
      if (scope() !== epoch) return;
      setAtTail(true);
      setJumpAt(null);
      setJumpError(null);
    } finally {
      if (scope() === epoch) setJumping(false);
    }
  }, [scope]);

  const clearJump = useCallback(() => {
    ++jumpToken.current;
    setIndex(null);
    setIndexError(null);
    setJumpAt(null);
    setJumpError(null);
    setAtTail(true);
  }, []);

  return {
    index,
    indexLoading,
    indexError,
    indexExhausted: index?.hasMore === false,
    loadIndex,
    atTail,
    jumpAt,
    jumping,
    jumpError,
    jumpTo,
    jumpOlder,
    jumpNewer,
    canJumpOlder,
    canJumpNewer,
    backToTail,
    clearJump,
  };
}

export { PAGE_LIMIT };
