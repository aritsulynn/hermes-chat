# Architecture

> How the pieces fit, and where the sharp edges are. Read this before changing
> the store, the gateway WebSocket wiring, or the connection pipeline.
> Last updated: 2026-10-04

## Layout

```
src/
  main.tsx      entry — mounts <App/>
  App.tsx       router: BrowserRouter on web, HashRouter in a native shell + AppProvider + routes
  AppShell.tsx  chrome around every screen: sidebar, toasts, connection banner, module-level bridges
  routes.tsx    URL -> screen table (the `path` doubles as the drawer key)
  platform.ts   native-shell detection + status-bar setup (Capacitor only)
  build.ts      the git-derived build id shown on Login/Settings
  theme.ts      TypeScript mirror of the colour tokens in global.css
  features/     screens, one directory each: index.tsx, plus helpers.ts / types.ts /
                components/ where the screen is big enough to warrant them
  store/        AppStore: useAppStore.tsx orchestrator + slices/ + shared runtime refs,
                plus the data layer — query-client.ts, ops-query.ts (useOpsQuery /
                useOpsMutation), ops-keys.ts
  services/     transport and typed endpoint wrappers — dashboard REST, gateway
                WebSocket, storage, native-http (Capacitor pipe that bypasses
                WebView cookie/CORS rules), plus one module per API surface
  components/   ui/ (reusables), chat/, drawer/, connection-banner
  hooks/        app-store.tsx (React context over the store), generic hooks
  utils/        pure helpers and types — no React imports
```

`capacitor.config.ts` is the native-shell manifest (`appId`, `webDir: 'dist'`).
`android/` is the Capacitor shell — tracked because it carries hand-written source
(`MainActivity`, `NativeHttpPlugin`, manifest flags), not just generated output.
Its build outputs (`.gradle/`, `*/build/`, `*.apk`) are ignored; a fresh clone
rebuilds them with the commands in the README.

## The store

`src/store/useAppStore.tsx` composes 20 slices — 18 through the `add()` helper,
plus `useThemeSlice` and `useNotificationsSlice` which take no context. They all
live under `src/store/slices/`; the orchestrator owns `refreshTail` and the other
cross-cutting helpers.

The orchestrator also owns the cross-cutting work: connection and auth, session
management, the turn engine, and the gateway WebSocket wiring (`openWs`). Slices
own their own state and refs; shared cross-cutting refs live in
`src/store/runtime.ts` to break ordering cycles. `src/hooks/app-store.tsx` exposes
the store through React context.

## Ops data layer

Chat and the session list live in the store, because they are driven by
WebSocket frames rather than by fetch. The ops screens are the opposite: plain
REST reads and writes.

They go through `useOpsQuery` / `useOpsMutation` in `src/store/ops-query.ts` on a
shared TanStack Query client (`query-client.ts`). That replaces the four
`useState` slots each screen used to hand-roll — data, loading, refreshing, error,
plus a `load()` callback and a mount effect — and it puts the connection scope in
the query key, so a response that arrives after a logout or a host switch cannot
render under the new connection. Nine screens are ported; the rest are listed in
[backlog.md](backlog.md).

## Services vs utils

`src/services/` holds everything that talks to a gateway: the transport itself
(`dashboard.ts`, `gateway-ws.ts`) and the typed wrappers that normalise each API
surface's payloads (`skills.ts`, `mcp.ts`, `profiles.ts`, …). `src/utils/` is pure
logic and types, with no React imports. Shared protocol constants live in the
import-free leaf `src/services/constants.ts`.

## Navigation

`src/routes.tsx` maps URLs to screens. Store slices route themselves from
WebSocket callbacks, where no hook is available, through the module-level bridge
in `src/store/nav.ts`.

## Theming

Colour tokens are declared in `global.css` and mirrored in `src/theme.ts` for
inline styles — change both. Tailwind registers `dark:` against a `.dark` class
(v4 has no `darkMode` config key), and the store toggles it on `<html>`.

---

## Session routing is the sharp edge

The gateway runs many concurrent sessions — cron jobs, background turns, other
devices. Every WebSocket event is filtered by `session_id` against the currently
open session, and getting that wrong is subtle in both directions: too little
filtering bleeds another session's output into the open chat, while too much makes
the chat appear completely hung. So if you touch `src/store/slices/useGateway.ts`,
`useTurn.ts`, or `useAskInbox.ts`:

- `session.info` from another session must not overwrite the open chat's model chip.
- Another session's `onAsk` must never hijack the current chat's ask sheet — it
  goes to the Ask Inbox. If a profile or stored session cannot be resolved, fail
  closed and surface it there rather than guessing which session owns it.
- Reconnect must restore `open_requests` without duplicating inbox entries, and
  must restore locked clarify answers.
- `stop()` must release the local turn even when the session died mid-turn, or the
  composer stays stuck on `generating`.
- Todo state must survive opening a session — restored from `todo_state`, never
  blanked by `setTodos([])`.
- Edit/resend must rewind the correct session; message row ids are per-session, so
  a stale id truncates the wrong history.
- Logout must fully reset composer state — no stuck Stop button, queue, todos,
  attachments or pending asks.

`isCurrentSession` in `useGateway.ts` is the predicate; `isCurrentSessionEvent`
(`src/utils/`) matches one id space against the other. Matching ids mean the
filter is fine; ids that never match mean the id spaces differ — the gateway
counts `active_sessions` in the sidebar for exactly this.

---

## Transport notes

**Two stacks, one store.** `dashboard.ts` and `gateway-ws.ts` are the whole
gateway conversation. `native-http.ts` swaps `fetch` for a Capacitor plugin on
native, because a WebView never attaches a `SameSite=lax` cookie cross-origin;
the session moves into a JS cookie jar that the plugin fills from `Set-Cookie`.
Web keeps plain `fetch`.

**Where the credentials live.** No password is ever persisted. The session cookie
stays in the browser's jar, where JS cannot read it; the app stores only a
`'web-jar'` marker so boot knows a silent reconnect is worth attempting. Host,
username, theme, active profile, last session, and model choice are persisted in
`localStorage`, scoped to host + username.

**Why the WS upgrade needs a ticket.** Browsers cannot set headers on a WebSocket
handshake, so the gateway mints a single-use 30-second ticket over REST
(`POST /api/auth/ws-ticket`) and the client passes it in the query string. It is
re-minted on every reconnect, never reused — which also means a cross-origin
client must be able to complete that REST call first. See
[troubleshooting.md](troubleshooting.md).
