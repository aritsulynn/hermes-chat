<p align="center">
  <img src="public/android-chrome-192x192.png" width="112" alt="Hermes" />
</p>

<h1 align="center">Hermes</h1>

<p align="center">
  A web and Android client for the <strong>Hermes agent gateway</strong> — streaming chat, tool calls,
  approvals, and session operations.
</p>

<p align="center">
  React 19 · Vite · TypeScript · React Router · Tailwind CSS v4 · Base UI + Radix UI
</p>

---

> [!IMPORTANT]
> **This repository is a client only — there is no backend here.** You need a reachable
> Hermes gateway (dashboard + JSON-RPC WebSocket) to sign in. The server address is
> entered on the login screen, not configured through the environment.

## Features

**Chat**

- Token-by-token streaming with collapsible reasoning / "thinking" blocks
- Tool call cards with live progress and inline diffs
- Markdown rendering with clickable file links
- Edit, resend, regenerate, and branch a conversation from any message
- Queue messages and steer a turn already in flight, or stop it
- Live todo list, context gauge, and per-session model / provider picker
- Slash commands, large-paste handling, and long transcripts windowed in memory

**Sessions & access**

- Profile-aware sessions with server-side pagination and live status in the drawer
- Dangerous-command approvals in three modes: `manual`, `smart`, or `off`
- Approvals and clarifying questions raised by _background_ sessions are routed to an **Ask Inbox** instead of hijacking the open chat
- Full-text search across message content, with the hit's snippet shown in the sidebar

**Agent configuration**

- **Models** — the resolved main model with context/capability badges, plus all auxiliary task slots
- **Profiles** — CRUD, active-profile switching, `SOUL.md` + description editing with auto-describe, export/import
- **Skills** — installed inventory with toggle and an editor; **Skills Hub** searches, previews, security-scans and installs from connected hub sources
- **Toolsets** — enable/disable tool groups, plus per-toolset provider and env configuration
- **MCP** — server CRUD with a test action, OAuth, and a catalog installer for declared env vars
- **Channels** — messaging platforms with enable/test and credential editing; Telegram/WhatsApp pairing

**Operations**

- Cron jobs — create, edit, pause, run now, and inspect run history with durations
- Kanban board for tracked tasks
- Server file browser — read, create, upload, rename, delete, download, with text previews and a binary-file guard
- Env / API key manager with set/unset state, provider labels, live provider probe, and reveal-on-demand
- Raw `config.yaml` editor with server-side YAML validation on save
- Plugin manager — installed plugins, a curated catalog, and memory/context provider pickers
- Webhooks with a one-time HMAC secret surfaced at creation
- Pairing approvals
- System / Ops — host stats, gateway start/stop, credential pool, and maintenance actions (doctor / security audit / backup / prune checkpoints) with a live log
- Gateway logs, and token/cost usage by day with a per-model breakdown

**App**

- Light / dark / system theme, plus a default or "Chamber" accent
- Local notifications when a turn finishes, including background sessions; they fire only while the app is backgrounded
- In-app panel for available server updates
- Web, or a Capacitor Android shell

## Screens

Every route below is a screen in `src/features/<name>`. `/login` renders outside the app
shell; unknown URLs fall back to `/chat`.

| Route         | Screen     | What it does                                       |
| ------------- | ---------- | -------------------------------------------------- |
| `/login`      | Login      | Gateway host and credentials                       |
| `/chat`       | Chat       | Streaming conversation, tools, todos, composer     |
| `/asks`       | Ask Inbox  | Pending approvals from background sessions         |
| `/cron`       | Cron Jobs  | Scheduled job CRUD, run history                    |
| `/files`      | Files      | Server file browser, previews, upload/download     |
| `/kanban`     | Kanban     | Task board                                         |
| `/skills`     | Skills     | Installed skill inventory, toggle, editor          |
| `/skills-hub` | Skills Hub | Search, preview and install from hub sources       |
| `/toolsets`   | Toolsets   | Enable/disable tool groups, per-toolset config     |
| `/mcp`        | MCP        | MCP servers and catalog                            |
| `/pairing`    | Pairing    | Pairing requests, approve and revoke               |
| `/profiles`   | Profiles   | Profile CRUD, active profile, SOUL.md editor       |
| `/plugins`    | Plugins    | Installed plugins, catalog, provider config        |
| `/keys`       | Keys / Env | Env vars and API keys, reveal, provider validation |
| `/config`     | Config     | Raw `config.yaml` editor                           |
| `/models`     | Models     | Main model and auxiliary task slots                |
| `/webhooks`   | Webhooks   | Webhook CRUD, enable/disable                       |
| `/system`     | System     | Host stats, gateway control, maintenance actions   |
| `/channels`   | Channels   | Messaging platforms and pairing                    |
| `/logs`       | Logs       | Gateway log stream                                 |
| `/usage`      | Usage      | Token and cost usage by day, by model              |
| `/settings`   | Settings   | Theme, accent, approvals, notifications, updates   |

`/` redirects to `/login`. Auth gating lives in the screens themselves.

## Requirements

- **Node.js** `^20.19.0 || >=22.13.0` — the strictest floor across the toolchain
  (ESLint 10 and typescript-eslint both want `^20.19.0 || ^22.13.0 || >=24`;
  Vite 7 is slightly looser at `>=22.12.0`)
- **npm**
- **A Hermes gateway** you can reach over HTTP — e.g. `http://your-server:9119`
- Android shell only: **JDK 21** (a full JDK — a JRE is not enough, and Gradle
  8.x cannot run on Java 25) plus the **Android SDK** (`ANDROID_HOME` set,
  build-tools and one platform installed)

## Getting started

```bash
git clone <this-repo>
cd hermes-mobile
npm install
npm run dev
```

Then open the printed URL and enter your gateway host (for example
`http://your-server:9119`) and your dashboard credentials.

The dev server binds all interfaces (`host: true`) because the gateway is usually
a plain-HTTP host on a LAN address.

## Configuration

There is no `.env` file and nothing to configure before the first run. The gateway
host and credentials are entered on the Login screen.

**What is persisted** (`localStorage`, scoped to host + username so switching
dashboards cannot leak one account's preferences into another): host, username,
theme and accent, active profile, last-opened session per profile, per-profile
model and provider choice.

**What is not persisted:** the session cookie stays in the browser's own jar,
where JS cannot read it — only a `'web-jar'` marker is stored so boot knows a
silent reconnect is worth attempting. The password is never stored at all; boot
clears it every time.

The build id shown on Login and Settings is read from git at config time
(`vite.config.ts`), so it cannot drift from the commit the bundle came from. It
falls back to `dev (vite)` against a dev server, and to `unknown` in a tarball or
CI build with no git.

## Project structure

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
  store/        AppStore: useAppStore.tsx orchestrator + slices/ + shared runtime refs
  services/     transport and typed endpoint wrappers — dashboard REST, gateway
                WebSocket, storage, native-http (Capacitor pipe that bypasses
                WebView cookie/CORS rules), plus one module per API surface
  components/   ui/ (reusables), chat/, drawer/, connection-banner
  hooks/        app-store.tsx (React context over the store), generic hooks
  utils/        pure helpers and types — no React imports
```

`capacitor.config.ts` is the native-shell manifest (`appId`, `webDir: 'dist'`).
`android/` is the Capacitor shell — tracked because it carries hand-written
source (`MainActivity`, `NativeHttpPlugin`, manifest flags), not just
generated output. Its build outputs (`.gradle/`, `*/build/`, `*.apk`) are
ignored; a fresh clone rebuilds them with the commands below.

## Architecture

- **Store.** `src/store/useAppStore.tsx` composes 20 slices from
  `src/store/slices/` (18 through the `add()` helper, plus `useThemeSlice` and
  `useNotificationsSlice`) and owns the cross-cutting orchestration: connection
  and auth, session management, the turn engine, and the gateway WebSocket wiring
  (`openWs`). Slices own their own state and refs; shared cross-cutting refs live
  in `src/store/runtime.ts` to break ordering cycles. `src/hooks/app-store.tsx`
  exposes the store through React context.
- **Services vs utils.** `src/services/` holds everything that talks to a
  gateway — the transport itself (`dashboard.ts`, `gateway-ws.ts`) and the typed
  wrappers that normalise each API surface's payloads (`skills.ts`, `mcp.ts`,
  `profiles.ts`, …). `src/utils/` is pure logic and types. Shared protocol
  constants live in the import-free leaf `src/services/constants.ts`.
- **Navigation.** `src/routes.tsx` maps URLs to screens. The store slices route
  themselves from WebSocket callbacks, where no hook is available, through the
  module-level bridge in `src/store/nav.ts`.
- **Theming.** Colour tokens are declared in `global.css` and mirrored in
  `src/theme.ts` for inline styles — change both. Tailwind is configured with
  `darkMode: 'class'` and the store toggles `.dark` on `<html>`.

### Session routing is the sharp edge

The gateway runs many concurrent sessions — cron jobs, background turns, other
devices. Every WebSocket event is filtered by `session_id` against the currently open
session, and getting that wrong is subtle in both directions: too little filtering
bleeds another session's output into the open chat, while too much makes the chat
appear completely hung. So if you touch `src/store/slices/useGateway.ts`,
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

When chat looks hung, log before guessing: a temporary log of `sid` in
`GatewayWs.dispatch` and of `event_sid` vs `sessionIdRef.current` in
`isCurrentSession` tells you whether the ids match. Matching ids mean the filter
is fine; ids that never match mean the id spaces differ.

## Development

```bash
npm run dev           # vite dev server
npm run typecheck     # tsc --noEmit
npm test              # node --experimental-strip-types --test
npm run lint          # eslint
npm run format        # prettier --write .
npm run format:check  # prettier --check
npm run build         # vite build
```

### Lint and format

ESLint 10 + typescript-eslint + `eslint-plugin-react-hooks`, with
`eslint-config-prettier` last so formatting is Prettier's job alone. A few
React-Compiler-oriented hook rules (`refs`, `immutability`,
`set-state-in-effect`, `preserve-manual-memoization`) are switched **off** — they
flag deliberate patterns here, notably slices that write refs during render so
callbacks frozen inside `openWs()` always read the latest values. Adopting them
is a refactor, not a config change.

Prettier covers everything except `dist/`, `node_modules/`, `public/`, and the
Capacitor/Gradle output.

### Android (Capacitor, debug)

```bash
npm run build
npx cap sync android
export JAVA_HOME=<path-to-jdk-21> ANDROID_HOME=$HOME/Android/Sdk
cd android && ./gradlew assembleDebug
```

The APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.
`JAVA_HOME` must point at a full JDK 21: the Gradle toolchain compiles with
release 21, and Gradle 8.x cannot run on newer JVMs. Changing `appId` makes
Android treat it as a different app — it installs alongside the old one and
starts with a fresh login.

Why the shell needs its own HTTP path: the app runs on `http://localhost`
while the gateway is a LAN host, and the gateway cookie is `SameSite=lax` —
a WebView never attaches that cookie cross-origin. So on native, dashboard
REST goes through the `NativeHttp` plugin with the session kept in the JS
cookie jar (`mergeCookies`), while web keeps using `fetch`. The WebSocket
needs no such treatment: it authenticates with a ticket in the URL.

### Tests

Tests are plain `.mjs` files run by Node's built-in test runner with
`--experimental-strip-types` — no test framework is installed. Because Node's type
stripping requires explicit extensions, tests import source with the `.ts` suffix:

```js
import { mergeUsage } from './usage.ts';
```

The glob in `package.json` is explicit, so **a new test file placed outside these
paths will silently never run**:

```
src/services/*.test.mjs   src/utils/*.test.mjs
src/features/*/*.test.mjs   src/store/*.test.mjs
```

Run one file with:

```bash
node --experimental-strip-types --test src/utils/usage.test.mjs
```

## Deployment

`npm run build` emits a static bundle in `dist/`. Because the router uses history
mode on web, the host must rewrite unknown paths to `index.html` (a deep link like
`/chat` has to survive a reload). Inside the Capacitor shell the router is
already hash-based, so no rewrite is needed — see "Android (Capacitor, debug)"
above for the APK flow.

```
/*  ->  /index.html  200
```

## Contributing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
scoped where it helps:

```
feat(asks): answer queued requests from the inbox
fix(chat): stop clipping the model name on wide screens
refactor(store): extract live-turn slice
```

The verification bar is `npm run typecheck` and `npm test`; neither can see gateway
behaviour, so anything touching sessions or the turn engine needs a manual pass
against a real gateway. `npm run lint` should also be clean, and `npm run
format:check` before committing.

`docs/feature-parity-roadmap.md` tracks what this client still lacks relative to
the full desktop dashboard in `~/.hermes/hermes-agent/web/`.

## License

[MIT](./LICENSE)
