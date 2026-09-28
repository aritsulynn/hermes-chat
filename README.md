<p align="center">
  <img src="assets/icon.png" width="112" alt="Hermes Mobile" />
</p>

<h1 align="center">Hermes Mobile</h1>

<p align="center">
  A native iOS / Android client for the <strong>Hermes agent gateway</strong> — streaming chat, tool calls, approvals, and session operations in your pocket.
</p>

<p align="center">
  Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript
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
- Markdown rendering with tappable file links
- Edit, resend, regenerate, and branch a conversation from any message
- Queue messages and steer a turn already in flight, or stop it
- Live todo list, context gauge, and per-session model / provider picker
- Slash commands, large-paste handling, and long transcripts windowed in memory

**Sessions & access**
- Profile-aware sessions with server-side pagination and live status in the drawer
- Biometric unlock (Face ID / Touch ID / device credential) before sending a reply from a notification
- Dangerous-command approvals in three modes: `manual`, `smart`, or `off`
- Approvals and clarifying questions raised by *background* sessions are routed to an **Ask Inbox** instead of hijacking the open chat

**Operations**
- Cron jobs — create, edit, pause, run now, and inspect run history with durations
- Kanban board for tracked tasks
- Server file browser with text previews and a binary-file guard
- Skills inventory, toolset toggles, gateway logs, and token/cost usage
- In-app panel for available server updates
- Light / dark / system theme

**Notifications**
- Background alerts when a turn finishes or the agent needs input
- Approve or reject from the notification, deferred and retried if the gateway is unreachable

## Screens

| Route | Screen | What it does |
| --- | --- | --- |
| `/login` | Login | Gateway host, credentials, biometric unlock |
| `/chat` | Chat | Streaming conversation, tools, todos, composer |
| `/asks` | Ask Inbox | Pending approvals from background sessions |
| `/cron` | Cron Jobs | Scheduled job CRUD, run history |
| `/files` | Files | Server file browser and previews |
| `/kanban` | Kanban | Task board |
| `/skills` | Skills | Installed skill inventory |
| `/toolsets` | Toolsets | Enable or disable tool groups |
| `/logs` | Logs | Gateway log stream |
| `/usage` | Usage | Token and cost usage by day |
| `/settings` | Settings | Theme, approvals, notifications, profiles, diagnostics |

`/` simply redirects to `/login`; auth gating lives in the screens themselves.

## Requirements

- **Node.js** `^20.19.4 || ^22.13.0 || ^24.3.0 || >=25` (required by React Native 0.86)
- **npm**
- **A Hermes gateway** you can reach over HTTP — e.g. `http://your-server:9119`
- **Xcode** (iOS, macOS only) and/or **Android Studio** for native builds
- **Expo account** if you want EAS builds or a cloud development build

> This project targets **development builds**, not Expo Go. The custom config
> plugins (cleartext HTTP for local development, splash screen, release signing) and
> the `eas.json` `development` profile only apply once the native project is
> generated, so run at least one native build before expecting the app to work
> end-to-end.

## Getting started

```bash
git clone https://github.com/aritsulynn/hermes-mobile.git
cd hermes-mobile
npm install
```

Then build and run for your platform — this compiles the native project the first
time and starts Metro:

```bash
npm run ios        # expo run:ios
npm run android    # expo run:android
npm run web        # expo start --web — browser, handy for quick UI work
```

On first launch, enter your gateway host (for example `http://your-server:9119`) and
your dashboard credentials. They are persisted on the device, so you only do this once.

Metro on its own, without a build, is available via `npm start` — useful when you just
want to reload or clear the cache.

For a shareable build that updates over the air, use the EAS development profile:

```bash
eas build --profile development --platform ios
```

## Configuration

There is **no `.env` file**, and no `EXPO_PUBLIC_*` variables. Everything is
configured in-app or in `app.json`:

| What | Where |
| --- | --- |
| Gateway host, credentials, theme | Entered on the Login screen, persisted on device |
| App name, icon, scheme, bundle IDs | `app.json` |
| Cleartext HTTP for local dev | `plugins/allow-cleartext.js` |
| Android release signing | `plugins/secure-release-signing.js` |

Release builds take their keystore from `HERMES_KEYSTORE_PATH`,
`HERMES_KEYSTORE_PASSWORD`, `HERMES_KEY_ALIAS`, and `HERMES_KEY_PASSWORD`
(`MYAPP_UPLOAD_*` is accepted as a fallback). The plugin deliberately throws
rather than falling back to the public debug keystore.

Bump `BUILD_ID` in `src/build.ts` on every shipped change. It is displayed on the
login and settings screens so a device can report exactly which bundle it is
running.

## Project structure

```
src/
  app/          expo-router routes — thin re-exports, one per screen
  features/     screen implementations: index.tsx + helpers.ts + types.ts + components/
  store/        AppStore: orchestrator + slices/ + shared runtime refs
  services/     transport only — dashboard REST, gateway WebSocket, storage
  components/   ui/ (reusables), chat/, drawer/
  utils/        pure helpers and types
plugins/        Expo config plugins
docs/           local working notes (not tracked in git)
```

Routes stay deliberately thin: `src/app/chat.tsx` renders `<ChatScreen />` from
`src/features/chat`. Screen logic belongs in the feature folder.

## Architecture

- **Store.** `src/store/useAppStore.tsx` composes ~21 slices from `src/store/slices/`
  and owns the cross-cutting orchestration: connection and auth, session management,
  the turn engine, and the gateway WebSocket wiring (`openWs`). Slices own their own
  state and refs; shared cross-cutting refs live in `src/store/runtime.ts` to break
  ordering cycles.
- **Services vs utils.** `src/services/` is transport only; `src/utils/` is pure logic
  and types. Shared protocol constants live in the import-free leaf
  `src/services/constants.ts`.
- **Theming.** shadcn-style colour tokens are declared in `global.css` and mirrored in
  `src/theme.ts` for inline styles — change both. NativeWind v4 is configured with
  `darkMode: 'class'` and `inlineRem: 16`.

### Session routing is the sharp edge

The gateway runs many concurrent sessions — cron jobs, background turns, other
devices. Every WebSocket event is filtered by `session_id` against the currently open
session, and getting that wrong is subtle in both directions: too little filtering
bleeds another session's output into the open chat, while too much makes the chat
appear completely hung. If you touch `src/store/slices/useGateway.ts`,
`useTurn.ts`, or `useAskInbox.ts`, read the gateway invariants in
[`AGENTS.md`](./AGENTS.md) first.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --experimental-strip-types --test
```

Both must be green before a change is considered done. There is no linter or
formatter configured.

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

### Native folders

`ios/` and `android/` are generated by Expo's continuous native generation and are
gitignored. Never hand-edit them — change `app.json` or a config plugin and rebuild.

## Releases

EAS build profiles are defined in `eas.json`:

| Profile | Purpose | Android artifact |
| --- | --- | --- |
| `development` | Dev client with live reload, internal distribution | — |
| `preview` | Internal test builds | `apk` |
| `production` | Store builds | `app-bundle` |

```bash
eas build --profile preview    --platform android
eas build --profile production --platform android
```

## Contributing

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/),
scoped where it helps:

```
feat(asks): answer queued requests from the inbox
fix(chat): stop clipping the model name on wide screens
refactor(store): extract live-turn slice
```

Typecheck and test after each change, and keep commits focused. If you are an AI
agent or a new contributor, read [`AGENTS.md`](./AGENTS.md) first — it documents the
conventions and the failure modes that are easy to miss.

## License

[MIT](./LICENSE)
