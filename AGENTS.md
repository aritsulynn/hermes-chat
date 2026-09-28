# AGENTS.md

Expo Router app that acts as a **client for a separate Hermes gateway/dashboard backend** (dashboard REST + a JSON-RPC WebSocket). There is no backend here — anything that "talks to the server" goes through `src/services/`.

## Commands

```bash
npm start          # expo start (Metro)
npm run android    # expo run:android  — dev build
npm run ios        # expo run:ios
npm run web        # expo start --web
npm run typecheck  # tsc --noEmit
npm test           # node --experimental-strip-types --test <globs>
```

- **No lint or formatter is configured.** `prettier-plugin-tailwindcss` is a devDependency but there is no prettier config or script — don't add formatting churn.
- **Verification bar is `npm run typecheck` + `npm test` only.** Both must be green before reporting done. Chat/gateway behaviour cannot be verified by either; see Manual QA below.

Single test file:

```bash
node --experimental-strip-types --test src/utils/usage.test.mjs
```

## Tests

Tests are `.test.mjs`, **not** `.ts`. They import source with an explicit `.ts` extension (`import { mergeUsage } from './usage.ts'`) because Node's `--experimental-strip-types` requires it. Use `node:test` + `node:assert/strict`; no test framework is installed and no React component tests exist — only pure logic in `utils/`, `services/`, `features/*/helpers.ts` and `store/`.

The glob in `package.json` is explicit. **A new test file outside these paths silently never runs:**

```
src/services/*.test.mjs  src/utils/*.test.mjs  src/features/*/*.test.mjs  src/store/*.test.mjs
```

## Architecture

```
src/app/         expo-router routes — thin re-exports, no screen logic
src/features/    one folder per screen (index.tsx + helpers.ts + types.ts + components/)
src/store/       the AppStore: useAppStore.tsx orchestrator + slices/ (21) + runtime.ts
src/services/    transport only (dashboard REST, gateway WS, connection/storage)
src/components/  ui/ (reusables), chat/, drawer/
src/utils/       pure helpers + types
```

- **Routes are thin.** `src/app/chat.tsx` is a 6-line file that renders `<ChatScreen />` from `src/features/chat`. Put screen logic in the feature folder, never in `src/app/`.
- **`src/hooks/app-store.tsx` is a 7-line re-export** of `src/store/useAppStore`. It exists only to keep the historical import path stable. Do not add implementation there.
- **Import paths:** the `@/` alias is used *only* inside `src/components/ui/` (the shadcn "reusables" registry, mirrored from `components.json` aliases). Everything else uses relative imports. Match the surrounding file.
- **`src/services/constants.ts` must stay an import-free leaf** — it is the shared timeout/limit/profile contract that any module may depend on.

### Store slices

`src/store/useAppStore.tsx` composes `src/store/slices/*` and owns only cross-cutting orchestration: connection/auth, session management, the turn engine, and `openWs`.

The pattern: **a slice owns its state/refs, the provider passes a deps object, and refs are returned for direct writes.** Leaf slices depend on orchestrator state, so the orchestrator must create them. Ordering cycles are broken by putting shared refs (`sessionIdRef`, `connectRef`, `openSessionRef`, …) in `src/store/runtime.ts`. Follow this when adding a slice.

Guardrails for store work: typecheck + test after every slice, one commit per slice, and **no big-bang rewrite of the orchestrator**. `openWs` was deliberately left in the orchestrator — it closes over ~50 symbols, so extracting it trades a long file for a ~50-entry deps object, not a simplification. Fixing that means moving mutable state behind a shared store object, which is a redesign, not a refactor.

## Theming (NativeWind v4)

- `global.css` declares the shadcn colour tokens; `src/theme.ts` mirrors the same values as `hsl()` strings for inline styles. **Change both.**
- `darkMode: 'class'`, not Tailwind's `media` default — deliberately, because `'media'` makes react-native-css-interop throw `Cannot manually set color scheme...` on web. Do not "fix" this back.
- `metro.config.js` sets `inlineRem: 16` so `1rem` == 16px and matches web. Don't change it without re-checking sizing.
- There is no `<ThemeProvider>`; the drawer builds its own navigation container and the store drives NativeWind's `setColorScheme`.

## Gotchas

- **No `.env` / env vars.** The gateway host is entered by the user on the Login screen (placeholder `http://your-server:9119`) and persisted. Don't introduce `EXPO_PUBLIC_*` config for host/auth.
- **`/ios` and `/android` are gitignored** — this project uses Expo CNG. Never hand-edit native files; change config plugins (`plugins/`) or `app.json` and rebuild.
- **Bump `BUILD_ID` in `src/build.ts`** on every shipped change. It is the only way a device can report which bundle it runs, and it is shown on Login and Settings.
- **Android release signing is env-driven** (`plugins/secure-release-signing.js`, `HERMES_*` / `MYAPP_UPLOAD_*`). Never let a release build fall back to the debug keystore.
- Keep protocol-level values (timeouts, limits, `DEFAULT_PROFILE`) in `services/constants.ts`; local UI timings stay next to the code that owns them.

## Gateway invariants (the highest-risk area)

This app is a foreground chat client for a gateway that runs *many* concurrent sessions — cron jobs, background turns, other devices. Almost every subtle bug in this codebase is a **session-routing leak**, so check these before touching `useGateway.ts` / `useTurn.ts` / `useAskInbox.ts`:

- **Every WS event is filtered by `session_id`** against the currently open session (`isCurrentSession`, `src/store/slices/useGateway.ts`). Both failure modes are bad and look identical from the outside: *under*-filtering bleeds another session's tokens/tools into the open chat; *over*-filtering (an id-space mismatch) makes chat look **completely hung** — nothing streams, no bubble ever resolves. Streaming a short message successfully is the canary for this.
- **`session.info` from another session must not overwrite the open chat's model chip.**
- **Another session's `onAsk` must never hijack the current chat's ask sheet.** It goes to the Ask Inbox (More → Ask Inbox) and may be answered from a notification. Notification replies use the *original* request id **exactly once**; if the gateway isn't ready, the reply is *deferred*, never dropped or sent to the wrong session.
- **If a profile or stored session can't be resolved, fail closed** — surface it in the inbox rather than guessing which session owns a request.
- **Reconnect must restore `open_requests`** without duplicating inbox entries and without re-sending notifications, and must restore locked clarify answers.
- **`stop()` must always release the local turn**, even when the session died or expired mid-turn, or the composer stays stuck on `generating` and the chat becomes unusable.
- **Todo state must survive opening a session** (restored from `todo_state`), not be blanked by a `setTodos([])`.
- **Edit/resend must rewind the correct session** — message row ids are per-session, so a stale id truncates the wrong session's history.
- **Logout must fully reset composer state** (no stuck Stop button, queue, todos, attachments, or pending asks).

**When chat appears hung, log before guessing.** Add a temporary log of `sid` in `GatewayWs.dispatch` (`src/services/gateway-ws.ts`) and of `event_sid` vs `sessionIdRef.current` in `isCurrentSession`, then compare: matching ids mean the filter is fine and the bug is elsewhere; ids that never match mean the id spaces differ. Remove the logs before committing.

Manual regression passes need a dev build, a real gateway, and a second device or terminal — you cannot self-serve them. If you change the gateway, sessions, or the turn engine, state explicitly which of the above a human should re-verify.

## Scope

Deliberately **not** implemented here (the desktop client has them; their absence is a decision, not a bug): multi-connection routing, skills hub / install / learned editing, MCP editing / test / OAuth, plugins management, toolset & provider configuration, git review / commit / push, native PTY / terminal, browser preview, split panes / multi-window, and a workspace tree (Files is a **server file browser**, not a workspace tree). Before adding a feature, confirm it belongs to this client rather than being a desktop-only concern.

## Conventions

- Commits are Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`) with a scope where it helps, e.g. `fix(chat): stop clipping the model name on wide screens`.
- The codebase is written for a human reader: dense, explanatory comments explain *why* a non-obvious choice was made, not what the line does. Keep that bar when editing.

## Not in version control

`docs/` is gitignored — a local working-notes folder, not repo content. If you find one there it may be stale (it predates the `lib/`→`services/` and `screens/`→`features/` renames, so paths inside it can be wrong). **Trust `src/` over any doc.** The durable knowledge from those files has been folded into this file.
