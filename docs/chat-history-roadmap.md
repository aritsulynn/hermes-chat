# Chat history roadmap

How long conversations are read and kept in sync. P1 is shipped; P2 and P3
are planned. **Read the design constraints before touching any history code** —
the first one is the trap that this whole document exists to prevent.

## Status

### P1 — offset paging (shipped ✅)

- Older history pages by advancing `offset` from the newest end
  (`order=latest&limit=50&offset=N`); the server clamps one request's `limit`
  at 500.
- Auto-load when the reader reaches the top — no "load older" button.
- 50 rows per page (initial tail and each older step).
- 2000-row in-memory ceiling; older loads stop silently at it.
- `sliceOlderThan` dedup. The fetch deliberately overlaps the current window by
  one page so its oldest durable row is present to anchor on, which also absorbs
  small offset drift from live messages arriving mid-read.
- No head trim while reading history (trim only fires at the bottom).

Files: `src/store/useAppStore.tsx` (`loadOlderMessages`, `trimHead`,
`refreshTail`), `src/store/runtime.ts` (`historyOffsetRef`),
`src/services/constants.ts` (`CHAT_HISTORY_PAGE`, `CHAT_WINDOW_MAX_LOADED`),
`src/utils/messages.ts` (`sliceOlderThan`), `src/services/api.ts` /
`src/services/dashboard.ts` (`offset`).

### P2 — cursor + sync correctness (planned)

The goal is not just to swap `offset` for a cursor: offset's correctness win is
invisible to the reader. The reader-visible win is **gap-free sync after a
reconnect** and **no duplicate/skipped rows while live messages arrive during a
history read**.

- Opaque cursor based on **display identity**, not a physical row id.
- Keyset over `(display_order, id)`.
- `message_uid` as the durable merge/dedup key.
- `nextCursor` + `hasMore` in the response, so the client never computes a
  position itself.
- Display-aware backward history (`before=<cursor>`).
- Display-aware forward sync (`after=<cursor>`).
- Integrate with the existing seq/replay reconnect path.
- Explicit history/live merge rules.

### P3 — local-first (planned)

- SQLite / local persistence.
- Instant startup: open a room and show the last-known transcript immediately.
- Optimistic send.
- Background sync.

## Design constraints (read before P2)

### 1. NEVER use a physical row id as the history cursor

> **Do not write `WHERE id < :cursor` (or `id > :cursor`) as the history
> cursor.**

The transcript a client sees is **not** the raw `messages` rows:

- reads pass `include_compacted` and `include_ancestors=True`, so the visible
  transcript spans **compression lineage** (parent → tip), not one physical
  session;
- the display set is **deduped** and has hidden rows removed;
- compaction/rewind reassign physical row ids.

A raw `id` keyset therefore **skips or duplicates rows across a compaction
rotation**, and looks correct in testing right up until the session compacts —
which is why this is easy to get wrong two months later when the schema shows
an `id` column that "obviously" orders the rows.

The durable cursor must come from the display identity. The schema already
carries the pieces: `display_identity`, `display_order`, and `message_uid`
(`hermes_state_common.py`, `messages` table). Return an **opaque cursor** built
from those, and let the server interpret it.

### 2. The existing `after_id` keyset is not reusable as-is

`SessionDB.get_messages` accepts `after_id`, but it is a **forward** keyset over
physical rows (`id > ? ORDER BY id ASC`) and it is **incompatible with
`latest`, `offset`, `include_compacted`, and `include_ancestors`** (it raises).
So `after=` for the display-aware sync direction needs its own display-identity
implementation — not a reuse of `after_id`.

### 3. Reconnect sync must integrate with the existing replay ring

The client already has a reconnect story: the gateway WebSocket replays with
`session.events.since` (see `WS_REPLAY_TIMEOUT_MS`, `WS_REPLAY_HOLD_MAX`) and a
REST resync rebuilds the tail. P2's forward sync should **extend the existing
seq watermark path**, not add a second, parallel gap-fill mechanism. Otherwise
two systems will disagree about "the last message I have".

### 4. History and live must merge on a stable key, with explicit rules

The UI renders one `messages` array. When history pages and live frames land in
the same list, the merge needs a stable identity and a written rule for:

- ordering (history is oldest→newest; live appends at the tail);
- dedup (a row can arrive as both a live frame and a history page);
- which side wins for a given field.

Use `message_uid` (durable occurrence id) — **not** the physical `rowId`, which
compaction/rewind can change. The merge rules belong in one place, not spread
across the store slices.

## Suggested cursor shape

```
server → { messages, nextCursor, hasMore }     // cursor is opaque
client → GET /messages?before=<nextCursor>&limit=50
server → keyset (display_order, id) DESC LIMIT 50
client → reverse → prepend
```

`after=` uses the same shape with the opposite direction.

## Next step when P2 starts

Design and lock the **server-side** cursor semantics first — display identity,
compaction/lineage behaviour, and replay seq integration. Do **not** start by
editing `api.ts` or the store: the semantics have to be settled before the
client can consume them.
