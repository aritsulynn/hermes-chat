# Chat history roadmap

How long conversations are read and kept in sync. P1 and the P2 client subset
are shipped; P2's backend-dependent half (cursor/display identity) is **BLOCKED**
on a server change, and P3 is planned. **Read the design constraints before
touching any history code** — the first one is the trap that this whole document
exists to prevent.

## Status

### P1 — offset paging (shipped ✅)

- Older history pages by advancing `offset` from the newest end
  (`order=latest&limit=50&offset=N`); the server clamps one request's `limit`
  at 500.
- Auto-load when the reader reaches the top — no "load older" button.
- 50 rows per page (initial tail and each older step).
- No in-memory ceiling: older loads continue until the server runs out. DOM
  stays bounded by the scroller's `content-visibility` (off-screen rows are not
  laid out).
- `sliceOlderThan` dedup. The fetch deliberately overlaps the current window by
  one page so its oldest durable row is present to anchor on, which also absorbs
  small offset drift from live messages arriving mid-read.
- No head trim while reading history (trim only fires at the bottom).

Files: `src/store/useAppStore.tsx` (`loadOlderMessages`, `trimHead`,
`refreshTail`), `src/store/runtime.ts` (`historyOffsetRef`),
`src/services/constants.ts` (`CHAT_HISTORY_PAGE`),
`src/utils/messages.ts` (`sliceOlderThan`), `src/services/api.ts` /
`src/services/dashboard.ts` (`offset`).

### P2 — cursor + sync correctness (client subset shipped ✅; cursor half BLOCKED ⛔)

**Scoped to the immutable backend** (`docs/chat-history-p2-feasibility.md`). The
server exposes no stable display identity and no cursor, so P2 is client-only.
Shipping status and the locked decisions are in
`docs/chat-history-p2-semantics.md`.

Shipped in P2 (client + existing contract):

- pin the history read with `include_compacted=true`, so the transcript is the
  deduped display projection and does not change shape when a session compacts;
- keep offset paging and dedup on that pinned read;
- harden reconnect with `latest_seq` / `truncated` / `epoch` + replay events.

Blocked on a backend change (do **not** fake):

- stable `displayId` / `displayOrder` — not exposed on any REST row;
- `before` / `after` cursor + `nextCursor` / `prevCursor` / `hasMore` — not
  supported (`limit`/`offset`/`order` only);
- `message_uid` on WS live/history — `_history_to_messages` ships `row_id` only
  and live frames carry no durable id;
- a robust history/live merge that needs a stable logical identity.

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

## Next step

The P2 cursor half is **gated on the backend** (see Blocked above): the server
must first expose a stable display identity and a cursor. Do **not** start it by
editing `api.ts` or the store — the semantics are already locked in
`docs/chat-history-p2-semantics.md` and the evidence is in
`docs/chat-history-p2-feasibility.md`. The next shippable client work is **P3**
(local-first).
