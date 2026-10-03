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

## 1. Ops screens still hand-roll their fetching — `M–L`

Sixteen of the eighteen screens that call `opsGet` still implement the fetch
shape by hand: four `useState` slots (data / loading / refreshing / error), a
`load()` callback, a mount effect, and a scope guard. `useOpsQuery` and
`useOpsMutation` in `src/store/ops-query.ts` replace all of it and put the
connection scope in the query key, so a superseded response cannot render under a
new connection. `kanban` and `webhooks` are ported.

**Seven have no race guard at all** — `cron`, `logs`, `mcp`, `skills`,
`skills-hub`, `system`, `usage`. They check `getAuthScope()` after awaiting, so
they are safe across a profile switch, but two overlapping loads of the same
screen can still land out of order: an older response overwrites a newer one.
`kanban` was the case that proved it — it ran two loads concurrently, wrote both
to one `useState`, and switching boards fast could repaint the previous board.

These seven first; they are the ones where the bug is real.

**Nine already guard correctly** and are a mechanical port: `channels`,
`config`, `files`, `keys`, `models`, `pairing`, `plugins`, `profiles`,
`toolsets`.

Per screen: one `useOpsQuery` for the read, one `useOpsMutation` per write with
`done: [[...]]` naming the keys to invalidate, and any optimistic write becomes
an `optimistic: { key, patch }` on the mutation hook.

Watch for the webhooks trap: a toggle switch swapped for a spinner while the
write is in flight hides the optimistic paint for the whole request, so the
optimistic update buys nothing. Keep the control mounted and `disabled`.

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
