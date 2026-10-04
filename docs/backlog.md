# Backlog

> Work found but not done, newest first. Each item says what it is, why it
> matters, and where the work lands. Ordered by how much it costs a user, not by
> how easy it is.
> Last updated: 2026-10-04

---

## 1. Unverified behaviour — `M`

Driven against a real gateway on 192.0.2.42:9119, but these were not observed:

- **The "Load older messages" button at rest.** Paging demonstrably works (a
  148-message session grew the scroller from 3.2k to 66k px), but the scroller
  holds its scroll anchor on prepend, so the header could not be parked in view
  for inspection. It may only ever be visible mid-scroll.
- **The `CHAT_HISTORY_MAX_ROWS` cap with real values.** Reached only by
  temporarily lowering it to 20/40; no session on this machine is long enough to
  hit 1200 for real.
- **`latest-descendant`** — now wired into `openSession`, but the redirect
  itself has still never been observed against a real gateway.
