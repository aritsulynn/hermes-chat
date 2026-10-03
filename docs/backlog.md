# Backlog

> Work found but not done, newest first. Each item says what it is, why it
> matters, and where the work lands. Ordered by how much it costs a user, not by
> how easy it is.
> Last updated: 2026-10-04

## How to test a change

The web client can only talk to a gateway on the **same origin** — the session
cookie is `SameSite=lax` and the browser enforces it, so `npm run dev` on
`localhost:5173` pointed at `192.168.1.8:9119` cannot log in. This is written up
in full, with the three working setups, under
[Deployment → the app and the gateway must share an origin](../README.md#the-app-and-the-gateway-must-share-an-origin);
the short version is: serve `dist/` from the gateway's origin, or run the dev
server on the gateway's own host.

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

## 2. `getLatestDescendant` is written but nothing calls it — `S`

`src/services/dashboard.ts` has `getLatestDescendant()`, hitting
`GET /api/sessions/{id}/latest-descendant`. No screen calls it. The desktop does
this on resume (`ChatPage.tsx:460` in the reference tree) so that opening a
parent session lands you in the branch that was actually continued.

Worth wiring into session open: follow the lineage once, best-effort, and never
block on it.

---

## 3. Unverified behaviour — `M`

Driven against a real gateway on 192.168.1.8:9119, but these were not observed:

- **The "Load older messages" button at rest.** Paging demonstrably works (a
  148-message session grew the scroller from 3.2k to 66k px), but the scroller
  holds its scroll anchor on prepend, so the header could not be parked in view
  for inspection. It may only ever be visible mid-scroll.
- **The `CHAT_HISTORY_MAX_ROWS` cap with real values.** Reached only by
  temporarily lowering it to 20/40; no session on this machine is long enough to
  hit 1200 for real.
- **`latest-descendant`** — endpoint wrapper only, never exercised.

---

## 4. P3 — check whether Capacitor ships an HTTP plugin — `S`, speculative

`NativeHttpPlugin` is hand-written because the WebView's `fetch` enforces the
browser cookie rules. If Capacitor has its own HTTP plugin with cookie handling,
that file and its Java can go. Low priority: what exists works, and this is a
guess either way until someone reads the Capacitor docs.

---

## 5. i18n + Thai — `L`

The only roadmap item still `missing`. Desktop has 20 locales, this app has none.
Large by any measure; see `feature-parity-roadmap.md` §2.

---

## Outside this repo

`~/.hermes/hermes-agent/hermes_cli/web_server.py` has an **uncommitted** local
edit: `allow_credentials=True` restored and `192.168.1.8` put back into
`allow_origin_regex`, so a same-host web client can authenticate. It needs a
gateway restart to take effect, and it was never restarted here — the running
instance still predates the edit.

The durable fix is to read the allowlist from config (`dashboard.cors_origins`,
following the `dashboard.public_url` pattern in
`dashboard_auth/prefix.py`) instead of a hardcoded regex, so a user of this app
adds one line to `config.yaml` rather than editing Python. Not done.
