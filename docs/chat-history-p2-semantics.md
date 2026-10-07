# P2 Step 0 — display-transcript semantics audit

Server-side trace only. This document is the design record; it does not change
`api.ts` / store / UI.

**Status:** audit complete, decisions 1–6 **locked** (§5). The **client-only
subset shipped** (§5.7): the history read is pinned to the display projection and
reconnect is hardened on the existing seq/replay contract. Everything that needs
a stable display identity or a cursor is **BLOCKED on a backend change** — not
implemented, not faked. Shipping status lives in
`docs/chat-history-roadmap.md`; the backend evidence is in
`docs/chat-history-p2-feasibility.md`.

Source of truth is the gateway at `~/.hermes/hermes-agent`. File:line references
are to that tree.

## 1. The pipeline

```
physical row (messages.id)
   → active / compacted visibility
   → display_identity (content hash)      [stored column]
   → display_order (min id of the group)  [stored column, trigger-maintained]
   → representative row (active, then newest id)
   → _project_for_display / session.resume projection
   → transcript the user sees
```

**Physical row.** `messages` (`hermes_state_common.py:449`): `id` autoincrement,
`role`, `content`, `timestamp`, `active`, `compacted`, `display_kind`,
`display_metadata`, `message_uid`, `display_identity`, `display_order`.

**Compaction / lineage.** Context compression ends the current session
(`end_reason='compression'`) and forks a child (`parent_session_id`). The
protected tail is **copied** into the child, so the same logical message can
exist as multiple rows (generations) with different physical ids.
`_resume_lineage_ids` (`hermes_state_messages.py:1678`) returns the verified
compression chain root→tip, or just the session for anything that is not a
compression continuation.

**Display identity.** `display_identity = sha256(_display_dedupe_key(row))`
(`hermes_state_messages.py:1203`). The key (`:1185`) is a stable tool key, else
`(role, normalized content, timestamp, tool_call_id, tool_calls, tool_name)`.
It is **content-addressed, not an id**. The trigger
`messages_display_identity_update` (`hermes_state_common.py:693`) nulls it when
any of those fields change, so an edit changes the logical identity.

**Display order.** `display_order = MIN(id)` of the group sharing a
`display_identity` (`messages_display_order_insert`, `:657`), recomputed by the
visibility trigger (`:668`) and by `_reconcile_display_orders`
(`hermes_state_messages.py:1225`) on drift. It is the logical message's **first
physical id**.

**Projection.** `_project_for_display` (`hermes_cli/web_routers/sessions.py:655`)
hides scaffolds, model-only rows and compaction summaries, and substitutes a
display view. `_row_to_message_dict` (`hermes_state_messages.py:1320`) **pops
`display_identity` and `display_order`** from the payload. The client therefore
never sees the two columns a cursor would naturally use.

## 2. The five questions

### 2.1 What is one display message?

A group of rows sharing a content-derived `display_identity`. Representative =
the row that is `active`, else the newest id
(`_display_rows_from_conn`, `hermes_state_messages.py:1357`); the group is
ordered by its **first** id (`_dedupe_display_generations:1221`).

But the definition is **path-dependent**, and the client currently takes the
non-deduped path:

| read path       | when                                      | what one message is                                               |
| --------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| raw             | single segment, `include_compacted=false` | one **physical active row** (`get_messages` else-branch, `:1429`) |
| display-indexed | single segment, `include_compacted=true`  | one `display_order` group (`_display_rows_from_conn`)             |
| lineage-deduped | compression lineage (>1 segment)          | one content-identity group (`_dedupe_display_generations`)        |

The mobile client calls `getSessionMessages` with **no `include_compacted`**, and
the route hardcodes `include_ancestors=True`
(`hermes_cli/web_routers/sessions.py:747`). So today:

- an uncompacted session → **raw active rows by `id`**;
- a compacted session → **content-deduped active rows across the lineage**.

The transcript's own definition changes when the session compacts. That is the
root reason a physical-`id` cursor cannot be right: the same session can switch
read paths underneath a cursor minted before compaction.

### 2.2 What must the cursor encode?

An **opaque, server-owned** token. The client must never parse it. Internally it
needs to identify a position in the logical display sequence, and the only key
that is consistent across all three paths is the **logical message's first
physical id** (`display_order` in the indexed path, `first_id` in the dedupe
path). Physical ids are globally autoincrement, so no segment tag is needed for
ordering.

Do **not** use: the representative row's `id` (it changes when the active
generation changes), or `display_identity` (a content hash, not an order), or
`message_uid` (see 2.5).

### 2.3 `before` semantics

`GET /messages?before=<cursor>&limit=N` must return **N display messages
strictly older than the cursor**, over the same display set the session reads.

- Single segment, indexed: `GROUP BY display_order HAVING display_order <
:firstId ORDER BY display_order DESC LIMIT N`, then representative selection —
  the existing `_display_rows_from_conn` query with a `WHERE` instead of
  `OFFSET`.
- Compression lineage: the current code **reads the entire lineage**
  (`_read_all … ORDER BY id`, `:1416`), dedupes in Python, then slices by
  offset. It is **not cursor-ready and not bounded**. A keyset on `first_id`
  works after the dedupe, but the query still materialises every row. This cost
  has to be addressed explicitly (per-segment indexed keyset merged across
  segments, or accept offset for lineage in P2).

### 2.4 `after` semantics

The live path is already the WS **seq/replay** ring, not history:

- every `event` frame gets a per-session monotonic `seq` and lands in a bounded
  ring (`tui_gateway/event_replay.py`; 512 events / 4 MiB per session / 64
  sessions / 64 MiB process);
- eviction and oversized frames raise a **truncation watermark**
  (`is_truncated`, `:144`), and the seq counter resets on restart, detected via
  `replay_epoch`;
- the client calls `session.events.since(last_seen)`
  (`src/services/gateway-ws.ts:1228`), parks live frames during the fetch, and
  dedups by `seq`.

So `after=<cursor>` must **not** become a second live channel. Its job is the
**refetch fallback**: when replay is truncated or the epoch changed, fetch the
display messages after the last known display position and merge — replacing
today's blunt "rebuild the newest 200 rows". Same `first_id` keyset, opposite
direction.

### 2.5 Merge rule — and a correction

The intended rule was `message_uid` = dedup identity. The audit says that is
true for **live frames** but **not for display history**:

- `message_uid` is minted **per physical row** (`hermes_state_common.py:648`
  trigger; `stamp_message_uid`). It is a durable _occurrence_ id.
- A display message's representative row can **switch** between generations
  (`active DESC, id DESC`). The logical message keeps its content identity but
  can change which `message_uid` is returned. Dedup by `message_uid` across two
  history fetches would then see a duplicate.

Correct split:

| key                                             | role                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| logical first id (`display_order` / `first_id`) | **history ordering + history dedup** (stable across generations) |
| `message_uid`                                   | **live-frame dedup** (one occurrence per frame)                  |
| event `seq`                                     | **replay ordering / gap detection** (WS only)                    |
| physical row `id`                               | implementation detail — **never a cursor, never a merge key**    |

This means the server must expose a **stable per-display-message identity** the
client can dedup on (an opaque `displayId` derived from the first id /
`display_identity`), because `display_identity` is currently stripped and
`message_uid` is not stable. It should also start emitting `message_uid` on WS
history/live frames — today `_history_to_messages`
(`tui_gateway/session_history.py:347`) ships only `row_id`.

## 3. Proposed contract (for review)

```
GET /api/sessions/{id}/messages?before=<opaque>&limit=50
GET /api/sessions/{id}/messages?after=<opaque>&limit=50
```

- `before` / `after` are mutually exclusive with `offset`; opaque to the client.
- Response adds:
  - `nextCursor` — position of the oldest row in this page (for the next `before`);
  - `prevCursor` — position of the newest row (for `after` / gap fill);
  - `hasMore` — whether a display row exists beyond the page in that direction;
  - per message: an opaque **`displayId`** (stable logical identity for dedup)
    and `message_uid` (occurrence).
- Internally the cursor encodes the logical first id plus a format version; the
  server owns encode/decode.
- `before`/`after` resolve to the same keyset on the logical first id, over the
  display set the session actually reads. The read path must be **pinned** so a
  session cannot switch definitions mid-cursor.

## 4. Design constraints (locked)

1. **Never use a physical row id as the history cursor.** The visible transcript
   spans compression lineage and content-deduped generations; `WHERE id < ?`
   skips or repeats across a compaction rotation.
2. `after_id` in `SessionDB.get_messages` is a forward physical keyset and is
   incompatible with `latest`/`offset`/`include_compacted`/`include_ancestors`
   (`hermes_state_messages.py:1402`) — it cannot be reused for display-aware
   sync.
3. Reconnect sync must extend the existing seq/replay ring + truncation
   watermark, not add a parallel gap-fill.
4. History and live must merge on a stable key with written rules; `message_uid`
   alone is not stable for history (see 2.5).

## 5. Decisions (locked)

Taken after the audit; binding for P2.

### 5.0 Three identity layers (the load-bearing separation)

```
physical row            implementation detail
    │
    ▼
logical display message
    ├── displayId     ← history identity (stable across generations)
    └── displayOrder  ← history ordering
message_uid             ← occurrence identity for live / replay
event seq               ← transport ordering / reconnect gap detection
```

`message_uid` must **not** come back as the primary history key: the audit found
it changes with the representative generation.

### 5.1 `include_compacted` — pin one canonical read path

The server exposes a single canonical transcript representation; the client does
not choose. The transcript must not change semantics with compact state
(`false` today → shape A, `true` after compaction → shape B) — that is exactly
what breaks a cursor. Compaction stays a server implementation detail behind the
API.

### 5.2 Stable display ID — BLOCKED (backend immutable)

Wanted: expose a stable per-display-message id (`displayId`) on history rows.
**Not available:** no wire serializer emits `display_identity` / `display_order`
(see `docs/chat-history-p2-feasibility.md`). `message_uid` is per physical row
and its representative can switch, so it is not a stable logical identity.
Marked blocked; **do not** fake it client-side.

### 5.3 `message_uid` on WS — BLOCKED (backend immutable)

Wanted: emit `message_uid` on WS history and live frames. **Not available:**
`_history_to_messages` ships only `row_id`, and live frames carry no durable
message id at all. Marked blocked; **do not** invent one.

### 5.4 Lineage cost — materialise first

P2 accepts the materialise-then-dedupe lineage read. Correctness of
identity/cursor comes first. If a real benchmark shows it is slow (e.g. 10k rows
→ 100 display messages), an incremental keyset becomes a P2.5/P3 optimisation —
not before.

### 5.5 Cursor invalidation — BLOCKED (backend immutable)

Wanted: an opaque, server-owned cursor with stale detection. **Not available:**
the REST history endpoint supports only `limit` / `offset` / `order` — no
`before` / `after` / `cursor`, and no `nextCursor` / `prevCursor` / `hasMore`.
Marked blocked; **do not** build a client-side token and call it a server
cursor.

### 5.6 Compacted history — part of the product transcript

What the user sees must be consistent before and after compaction. Compacted
display history is part of the transcript, not an internal artifact the client
may or may not request.

### 5.7 Feasibility outcome — P2 is client-only

The backend is immutable (`docs/chat-history-p2-feasibility.md`). P2 therefore
ships only what the existing contract supports, and marks the rest blocked:

**Implemented in P2 (client + existing contract):**

- pin the history read with `include_compacted=true` so the transcript is the
  deduped display projection and does not change shape on compaction (5.1, 5.6);
- keep offset paging and dedup on the pinned read (5.4);
- harden reconnect using `latest_seq` / `truncated` / `epoch` + replay events.

**Blocked on a backend change (not implemented, not faked):**

- stable `displayId` (5.2);
- `message_uid` on WS live/history (5.3);
- `before` / `after` cursor + `nextCursor` / `prevCursor` / `hasMore` (5.5);
- a robust history/live merge that needs a stable logical identity.

## 6. Golden regression fixture (build in P2 Step 1)

The earlier `zztest-long-history` fixture (plain 2 626 rows) is **not
sufficient**: P2 is about display semantics, not pagination. It can stay as a
plain long-history case, but P2 adds a **golden regression fixture** for the
history system that must cover:

- > 2000 display messages;
- a real compression lineage (parent ended `end_reason='compression'` + child);
- compacted rows (`active=0, compacted=1`);
- hidden rows (`display_kind='hidden'`) and model-only rows;
- duplicate generations (protected tail copied into the child);
- live insertion during a history read;
- a reconnect with replay truncation.
