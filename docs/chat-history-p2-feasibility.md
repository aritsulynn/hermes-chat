# P2 contract feasibility audit

**Status:** complete. Conclusion — P2 is **client-only**: the "doable client-side"
rows below shipped, the "backend missing" rows are **BLOCKED** on a backend
change. See `docs/chat-history-roadmap.md` for what shipped.

Premise: **the backend is immutable.** P2 must be built on the contract the
server already exposes; no new endpoint, field, or query param may be invented
to make a spec pass.

Method: ran the real server projection functions on the golden fixture DB and
read the real serializers (no guessing).

- REST rows: `hermes_cli/web_routers/sessions.py::_project_for_display` over
  `hermes_state_messages.py::_row_to_message_dict`.
- WS history: `tui_gateway/session_history.py::_history_to_messages`.
- Live frames: `tui_gateway/*` event emitters, as consumed by
  `src/services/gateway-ws.ts` (the client's own event switch).
- Replay: `tui_gateway/methods_session.py::session.events.since`.
- Golden DB: `src/services/__fixtures__/p2-golden.json` (real compaction +
  real compression lineage).

The app parses `body.messages` (dashboard route shape), so the REST findings are
for that route. (The gateway `api_server` variant returns `data` and drops even
`message_uid`; it is not the shape the app reads.)

## 1. REST history — fields that actually arrive

`GET /api/sessions/{id}/messages` row keys (probed):

```
id, session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp,
active, compacted, display_kind, display_metadata, message_uid,
absorbed_message_uids, tool_call_uids, reasoning, reasoning_content,
reasoning_details, token_count, finish_reason, ...
```

- **Present:** `id` (physical), `message_uid` (occurrence), `active`,
  `compacted`, `display_kind`, `display_metadata`, `timestamp`.
- **Absent:** `display_order`, `display_identity`.
- **Query params:** `limit` (server-clamped ≤500), `offset`, `order`
  (`oldest|latest`), `include_compacted`, `inline_images`, `profile`.
- **Pagination object:** `{limit, offset, order, returned}` only.

## 2. Stable display identity — **not available**

No wire serializer emits `display_order` or `display_identity` anywhere
(verified across `tui_gateway/`, `gateway/`, `hermes_cli/web_routers/`). The
columns exist in the DB and are what the display read groups/orders by, but they
are stripped by `_row_to_message_dict` before serialization.

`message_uid` is **per physical row** and the display representative can switch
generations (`active DESC, id DESC`), so it is not stable for a logical message
across fetches.

Deriving the identity client-side (hashing role/content/timestamp/tool identity
to reproduce `display_identity`) would duplicate the server's normalization
(handoff/steer content, stable tool key) and is fragile — that is **faking** and
is out of bounds.

## 3. Pagination / cursor — **not available**

Only `limit` + `offset` + `order`. There is **no** `before` / `after` / `cursor`
param, and **no** `nextCursor` / `prevCursor` / `hasMore`.

`after_id` exists only on the **export** stream
(`export_session_endpoint`: `db.get_messages(limit=500, after_id=last_id,
include_inactive=True)`) — a forward, physical-id, full-session dump that also
strips the display fields. It is not the transcript endpoint and cannot page
history backward.

## 4. WS live/history identity — **not available**

- `_history_to_messages` emits `row_id` (physical) and never `message_uid`.
- Live frames carry **no durable message id**: `message.delta`/`reasoning.delta`
  carry `text` only; `tool.*` carry `name`/`tool_id`/`args`/`preview`/`result`
  (`tool_id` is the tool-call id, not a message id).

Today the client bridges the gap by aligning live bubbles to REST rows by
content (`stampRowIdsRef`).

## 5. Reconnect / replay — **available**

`session.events.since` returns:

```
{ events, latest_seq, truncated, count, epoch, open_requests }
```

`seq` watermark, `truncated` (ring eviction), and `epoch` (restart detection)
are all exposed, and the client already consumes them
(`src/services/gateway-ws.ts`). Gap detection is feasible with the existing
contract.

## 6. Merge / dedup data — partial

- History rows give `id` + `message_uid` + role/content/timestamp.
- Live frames give none of those.
- So a **stable cross-source merge key is not exposed**; history-vs-live merge
  stays content-alignment.

## Classification

| P2 requirement                                                | existing contract                                                   | verdict                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Canonical single read path (no semantics flip on compact)     | `include_compacted=true` param exists                               | **doable client-side**                                             |
| Offset paging                                                 | `limit`+`offset`+`order`                                            | **done (P1)**                                                      |
| Reconnect gap detection                                       | `latest_seq` + `truncated` + `epoch`                                | **doable client-side**                                             |
| History dedup within a pinned read                            | `id` + `message_uid` present                                        | **partial** — stable only while the representative does not switch |
| Stable `displayId`                                            | not exposed                                                         | **backend missing — mark not-doable, do not fake**                 |
| `displayOrder` ordering                                       | not exposed as a field (order is implicit in the returned sequence) | **backend missing**                                                |
| `before`/`after` cursor + `nextCursor`/`prevCursor`/`hasMore` | not supported                                                       | **backend missing**                                                |
| `message_uid` on WS live frames                               | not exposed                                                         | **backend missing**                                                |
| Robust history/live merge                                     | live frames have no durable id                                      | **backend missing**                                                |

## What P2 can actually deliver (client + existing contract only)

1. Pin the read path: always send `include_compacted=true` so the server returns
   the deduped display projection and the transcript no longer changes shape
   when a session compacts (decision 5.1, achievable without backend change).
2. Keep offset paging (P1) and dedup by `id`/`message_uid` within the pinned read.
3. Harden reconnect using `latest_seq` / `truncated` / `epoch` (extend the
   existing replay path) so a reconnect does not duplicate or drop live turns.

## Blockers (require a backend change — report, do not implement)

1. Expose a stable display identity on REST rows (`display_identity` /
   `display_order`, or an opaque `displayId`).
2. Add `before`/`after` cursor + `nextCursor`/`prevCursor`/`hasMore`.
3. Emit `message_uid` on WS history and live frames.

## Consequence for the Step 1 spec

`src/services/history-cursor.test.mjs` encodes the backend-dependent contract
(displayId, cursor, WS `message_uid`). Those tests **cannot pass** on the
immutable backend. Per the rule, they are **not-doable in P2** — mark them as
blocked rather than implementing fakes. The three client-only items above are
the implementable subset.

## Recommendation (resolved)

Option (a) was taken: implement the client-only subset (pin `include_compacted` +
harden reconnect), and relabel the cursor/displayId specs as blocked on the
backend. The three backend changes in **Blockers** remain the gate for the full
locked contract. Do not fake the missing identity.

The blocked specs live in `src/services/__blocked__/history-cursor.blocked.mjs`
and run via `npm run test:p2`; they are expected to fail until the backend ships
the identity/cursor contract.
