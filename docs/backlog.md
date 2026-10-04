# Backlog

> Work found but not done, newest first. Each item says what it is, why it
> matters, and where the work lands. Ordered by how much it costs a user, not by
> how easy it is.
> Last updated: 2026-10-04

---

## 1. Nine ops screens still hand-roll their fetching — `M–L`

`useOpsQuery` and `useOpsMutation` in `src/store/ops-query.ts` replace the
hand-rolled fetch shape — four `useState` slots (data / loading / refreshing /
error), a `load()` callback, a mount effect, and a scope guard — and put the
connection scope in the query key, so a superseded response cannot render under
a new connection.

**Done:** `kanban`, `webhooks`, `skills`, `logs`, `usage`, `system`, `mcp`,
`skills-hub`, `cron`. The seven that had no race guard at all are the ones that
mattered: they checked `getAuthScope()` after awaiting, so they were safe across
a profile switch, but two overlapping loads of the same screen could still land
out of order. `kanban` was the case that proved it.

**Left — nine screens that already guarded correctly**, so these are mechanical:
`channels`, `config`, `files`, `keys`, `models`, `pairing`, `plugins`,
`profiles`, `toolsets`. No bug to fix, only consistency.

Per screen: one `useOpsQuery` for the read, one `useOpsMutation` per write with
`done: [[...]]` naming the keys to invalidate, and any optimistic write becomes
an `optimistic: { key, patch }` on the mutation hook.

Two traps the ported screens ran into, both now fixed there and both worth
knowing before the remaining nine:

- **A toggle swapped for a spinner hides the optimistic paint for the whole
  request**, so the optimistic update buys nothing. Keep the control mounted and
  `disabled`. (`skills`, `mcp`)
- **A disabled query stays `pending` forever**, so any `isPending` you turn into
  a spinner has to be gated on the thing that enables it — an applied search
  term, a selected job. (`skills-hub`, `cron`)

Payload normalisers belong in the screen's `helpers.ts` as `select`, where they
are pure and testable; that is where `asLogLines`, `asCronJobs` and
`asDeliveryTargets` went.

**Not verified against a real gateway.** `npm test` cannot see any of this, and
these screens only got a typecheck. The behaviour changes to watch for are in
the individual commits: a 404 is now retried once, returning to a screen inside
`staleTime` renders cached rows instead of refetching, and switching a filter
now shows a spinner where some screens used to hold the previous rows.

---

## 2. Unverified behaviour — `M`

Driven against a real gateway on 192.168.1.42:9119, but these were not observed:

- **The "Load older messages" button at rest.** Paging demonstrably works (a
  148-message session grew the scroller from 3.2k to 66k px), but the scroller
  holds its scroll anchor on prepend, so the header could not be parked in view
  for inspection. It may only ever be visible mid-scroll.
- **The `CHAT_HISTORY_MAX_ROWS` cap with real values.** Reached only by
  temporarily lowering it to 20/40; no session on this machine is long enough to
  hit 1200 for real.
- **`latest-descendant`** — now wired into `openSession`, but the redirect
  itself has still never been observed against a real gateway.
