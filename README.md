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

<p align="center">
  <a href="https://github.com/aritsulynn/hermes-chat/actions/workflows/ci.yml">
    <img src="https://github.com/aritsulynn/hermes-chat/actions/workflows/ci.yml/badge.svg" alt="CI" />
  </a>
  <a href="https://github.com/aritsulynn/hermes-chat/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  </a>
</p>

---

> [!IMPORTANT]
> **This repository is a client only — there is no backend here.** You need a reachable
> Hermes gateway (dashboard + JSON-RPC WebSocket) to sign in. The server address is
> entered on the login screen, not configured through the environment.

## Features

**Chat** — token-by-token streaming with collapsible reasoning blocks; tool call
cards with live progress and inline diffs; markdown with clickable file links;
edit, resend, regenerate and branch from any message; message queue, turn steering
and stop; live todo list, context gauge, per-session model picker; slash commands,
large-paste handling, long transcripts windowed in memory.

**Sessions & access** — profile-aware sessions with server-side pagination and
live status; dangerous-command approvals in three modes (`manual`, `smart`, `off`);
approvals and clarifying questions from _background_ sessions routed to an **Ask
Inbox** instead of hijacking the open chat; full-text search with the hit's snippet
in the sidebar.

**Agent configuration** — **Models**: the resolved main model with
context/capability badges, plus every auxiliary task slot. **Profiles**: CRUD,
active-profile switching, `SOUL.md` and description editing with auto-describe,
export/import. **Skills** / **Skills Hub**: installed inventory with toggle and
editor; hub search, preview, security scan and install. **Toolsets**:
enable/disable groups with per-toolset provider and env config. **MCP**: server
CRUD, test action, OAuth, catalog installer. **Channels**: messaging platforms
with enable/test and credential editing, Telegram/WhatsApp pairing.

**Operations** — cron jobs with run history and durations; a kanban board; a server
file browser (read, create, upload, rename, delete, download, text previews, a
binary-file guard); an env/API-key manager with provider probe and reveal on
demand; a raw `config.yaml` editor with server-side YAML validation; a plugin
manager with catalog and memory/context provider pickers; webhooks with a one-time
HMAC secret; pairing approvals; host stats, gateway control and maintenance
actions (doctor, security audit, backup, prune checkpoints) with a live log;
gateway logs and token/cost usage by day and by model.

**App** — light/dark/system theme with a default or "Chamber" accent; local
notifications when a turn finishes, including background sessions; an in-app
update panel; web or a Capacitor Android shell.

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

- **Node.js** `^22.13.0 || >=24`. Two floors meet here: ESLint 10 wants
  `^22.13.0 || >=24` (it excludes Node 23), and `npm test` needs
  `--experimental-strip-types`, which arrived in 22.6. Vite 7 alone would allow
  `^20.19.0 || >=22.12.0`, so the app builds on Node 20 — but the test suite does
  not run there, which is why `engines` does not claim it.
- **npm**
- **A Hermes gateway** you can reach over HTTP — e.g. `http://your-server:9119`
- Android shell only: **JDK 21** (a full JDK — a JRE is not enough, and Gradle
  8.x cannot run on Java 25) plus the **Android SDK** (`ANDROID_HOME` set,
  build-tools and one platform installed)

## Getting started

```bash
git clone <this-repo>
cd hermes-chat
npm install
npm run dev
```

Then open the printed URL and enter your gateway host (for example
`http://your-server:9119`) and your dashboard credentials.

The dev server binds all interfaces (`host: true`) because the gateway is usually
a plain-HTTP host on a LAN address. You can open it on any host — but that makes
the client cross-origin, so the gateway has to allow that origin, and it has to
answer the CORS preflight. If the login fails with `Failed to fetch`, see
[docs/troubleshooting.md](docs/troubleshooting.md); if you would rather not
think about it, open the dev server on the gateway's own host
(`http://your-server:5173`) or serve a build from the gateway's origin.

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
src/features/    one directory per screen        docs/     troubleshooting, backlog,
src/services/    gateway transport + API surface             roadmap, architecture
src/store/       AppStore, slices, ops query layer
src/components/  ui/, chat/, drawer/             android/   Capacitor shell
src/utils/       pure helpers, no React         .github/   CI
```

[docs/architecture.md](docs/architecture.md) has the annotated layout, including
what each store module is for.

## Architecture

The shape in one paragraph: `src/features/` holds one directory per screen,
`src/services/` is everything that talks to the gateway (REST in `dashboard.ts`,
the WebSocket in `gateway-ws.ts`), and `src/store/` composes 21 slices that own
the client state. Chat and the session list live in the store because they are
driven by WebSocket frames; the ops screens are plain REST and go through
`useOpsQuery` / `useOpsMutation` on a shared TanStack Query client instead.

**[docs/architecture.md](docs/architecture.md)** covers the layout in full, the
slice composition, and the one place that is genuinely hard: session routing,
where every WebSocket event must be filtered against the open session and
getting it wrong either bleeds another session's output into the chat or makes
the chat look hung.

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
`eslint-config-prettier` last so formatting is Prettier's job alone. The repo
carries known `react-hooks/exhaustive-deps` warnings on purpose — see
[CONTRIBUTING.md](CONTRIBUTING.md) before touching one.

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

Why the shell needs its own HTTP path: a WebView never attaches the gateway's
`SameSite=lax` cookie cross-origin, so on native dashboard REST goes through the
`NativeHttp` plugin with the session kept in a JS cookie jar, while web keeps
using `fetch`. [docs/architecture.md](docs/architecture.md#transport-notes) has
the detail.

### Tests

Plain `.mjs` files on Node's built-in runner — no framework. The glob in
`package.json` is explicit, so a test outside those paths never runs; see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Deployment

`npm run build` emits a static bundle in `dist/`. Because the router uses history
mode on web, the host must rewrite unknown paths to `index.html` (a deep link like
`/chat` has to survive a reload). Inside the Capacitor shell the router is
already hash-based, so no rewrite is needed — see "Android (Capacitor, debug)"
above for the APK flow.

```
/*  ->  /index.html  200
```

### Serving from another origin

A cross-origin client needs two things from the gateway: its origin in the
allowlist (`dashboard.cors_origins`, or `HERMES_DASHBOARD_CORS_ORIGINS` — loopback
is always allowed), and a `CORSMiddleware` that is the gateway's outermost
middleware. When the second is missing, the gateway answers the CORS preflight
itself and the login fails with `Ticket request failed: Failed to fetch` while the
gateway is answering `200` throughout.

Same-origin remains the most robust deployment because it needs neither. Both the
requirements and the gateway-side patch are in
[docs/troubleshooting.md](docs/troubleshooting.md).

## Contributing

`CONTRIBUTING.md` has the bar: `npm run typecheck`, `npm test`, `npm run lint`,
`npm run format:check` — the same four CI runs on every PR. Anything touching
sessions or the turn engine also needs a manual pass against a real gateway,
because CI cannot see gateway behaviour.

`docs/feature-parity-roadmap.md` tracks what this client still lacks relative to
the full desktop dashboard in the gateway's `web/`. `docs/backlog.md` records work
that was found but not done.

## License

[MIT](./LICENSE) — see also [CONTRIBUTING.md](CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and
[SECURITY.md](SECURITY.md).
