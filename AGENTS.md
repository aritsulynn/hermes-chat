# AGENTS.md

A **web client for a separate Hermes gateway/dashboard**. React 19 + Vite 7 +
Tailwind. There is no backend here — anything that "talks to the server" goes
through `src/services/`.

This was a React Native / Expo app until the platform port. The port is
complete: nothing in `src` imports `react-native`, `expo-*`, `nativewind`,
`@rn-primitives`, `@gorhom`, `@shopify` or `lucide-react-native`. See
"Platform port" below for what changed and what was deliberately dropped.

## Commands

```bash
npm run dev        # vite
npm run build      # vite build
npm run preview    # serve the build
npm run typecheck  # tsc --noEmit
npm test           # node --experimental-strip-types --test <globs>
```

- **No lint or formatter is configured.** `prettier-plugin-tailwindcss` is gone
  and there is no prettier config — don't add formatting churn.
- **Verification bar is `npm run typecheck` + `npm test`**, both of which must be
  green before reporting done. Neither can see chat/gateway behaviour; see
  Manual QA.

Single test file:

```bash
node --experimental-strip-types --test src/utils/usage.test.mjs
```

## Tests

Tests are `.test.mjs`, **not** `.ts`. They import source with an explicit `.ts`
extension (`import { mergeUsage } from './usage.ts'`) because Node's
`--experimental-strip-types` requires it. Use `node:test` + `node:assert/strict`;
no test framework is installed and no React component tests exist — only pure
logic in `utils/`, `services/`, `features/*/helpers.ts` and `store/`.

The glob in `package.json` is explicit. **A new test file outside these paths
silently never runs:**

```
src/services/*.test.mjs  src/utils/*.test.mjs  src/features/*/*.test.mjs  src/store/*.test.mjs
```

Anything needing a DOM (`services/clipboard.ts`, `services/file-picker.ts`) is
deliberately *not* in that set — there is nothing meaningful to assert about it
without one, and a mock of the thing under test tests the mock.

**No JSX is under test at all, and that is a real gap.** The harness is
`node --experimental-strip-types`, which cannot load a `.tsx` file, so every
component in this repo is verified only by typecheck and by running the app. The
sharpest case is `components/chat/markdown.tsx`: the port replaced
`react-native-markdown-display` with `react-markdown`, and nothing automated
confirms the output. What *is* tested is the pure preprocessing that feeds it —
`cleanThinking`, `flattenLists` and `renderMediaTags` in
`utils/markdown-preprocess.test.mjs`. If you change the renderer, that file is
the safety net for its input, not for its output; check the rest by hand.

## Architecture

```
src/app/         routes + the app shell (RootLayout owns the drawer)
src/features/    one folder per screen (index.tsx + helpers.ts + types.ts + components/)
src/store/       the AppStore: useAppStore.tsx orchestrator + slices/ (20) + runtime.ts
src/services/    transport only (dashboard REST, gateway WS, connection/storage, platform)
src/components/  ui/ (reusables), chat/, drawer/
src/utils/       pure helpers + types
```

- **Routes are thin.** `src/app/chat.tsx` is a few lines that render
  `<ChatScreen />` from `src/features`. `app/routes.tsx` is the table that maps
  paths to those files — expo-router used to derive it from the filenames.
  Screen logic belongs in the feature folder, never in `src/app/`.
- **`src/hooks/app-store.tsx` is a re-export** of `src/store/useAppStore`. It
  exists only to keep the historical import path stable. Do not add
  implementation there.
- **Import paths:** the `@/` alias is used *only* inside `src/components/ui/`
  (the shadcn "reusables" registry, mirrored from `components.json`). Everything
  else uses relative imports. Match the surrounding file.
- **`src/services/constants.ts` must stay an import-free leaf** — it is the
  shared timeout/limit/profile contract that any module may depend on.

### Store slices

`src/store/useAppStore.tsx` composes `src/store/slices/*` and owns only
cross-cutting orchestration: connection/auth, session management, the turn
engine, and `openWs`.

The pattern: **a slice owns its state/refs, the provider passes a deps object,
and refs are returned for direct writes.** Leaf slices depend on orchestrator
state, so the orchestrator must create them. Ordering cycles are broken by
putting shared refs (`sessionIdRef`, `connectRef`, `openSessionRef`, …) in
`src/store/runtime.ts`. Follow this when adding a slice.

Guardrails for store work: typecheck + test after every slice, one commit per
slice, and **no big-bang rewrite of the orchestrator**. `openWs` was deliberately
left in the orchestrator — it closes over ~50 symbols, so extracting it trades a
long file for a ~50-entry deps object, not a simplification. Fixing that means
moving mutable state behind a shared store object, which is a redesign, not a
refactor.

### Navigation

`expo-router` is gone. React Router in history mode, plus two module-level
bridges in `src/store/nav.ts` — `navigate`/`openNavDrawer`. They exist because
the store slices and the header buttons navigate from WS callbacks and press
handlers where `useNavigate` is not available, and threading a hook through
`openWs` is exactly the trap described above. `RootLayout` registers the real
implementations. The dev server serves `index.html` for unknown paths; a static
host needs the equivalent rewrite rule, or deep links 404 on reload.

**A reload of a non-chat route has two ways to lose the place**, both of which
were live before the first authenticated run, and both are easy to reintroduce:

- `RootLayout` withholds `<Outlet />` while the store is booting. Every screen
  guards itself with `if (!authed) return <Redirect to="/login" replace />`, and
  on a hard load that guard sees `authed === false` before the cookie has been
  checked — so without the gate a reload of `/logs` went `/logs` → `/login` →
  `/chat`.
- `openSession` takes `{ navigate: false }`, and the boot path in `useConnection`
  passes it. Landing on `/chat` is right when the user picks a session from the
  drawer and wrong when boot is calling it only to restore the last one. The
  unconditional navigate it used to have turned every deep link into `/chat`.

History mode means **the gateway host must allow this origin in CORS** — see the
CORS diagnostic in `services/dashboard.ts`.

## Theming

`global.css` declares the shadcn colour tokens; `src/theme.ts` mirrors the same
values as `hsl()` strings for inline styles. **Change both.**

`darkMode: 'class'`, and the store toggles `.dark` on `<html>` directly
(`useThemeSlice`). That is what lets a saved preference override the OS. The
NativeWind reason for the setting is gone; the choice is not, because the
behaviour is what matters.

Safe areas are `env(safe-area-inset-*)` in CSS, not measured numbers. Several
components used to take an `insetTop: number` prop that every call site had to
thread a value into; all of them read `env()` now.

## Platform port

What the port changed, so the reasoning is not re-derived:

- **`flex-row` does not exist in web Tailwind.** `flex` already means
  `display:flex` with row direction. 122 occurrences became `flex`. If you add
  a class from memory of the native code, check it against the web scale.
- **A converted `<View>` needs its defaults written out.** React Native's `<View>`
  is `display:flex; flex-direction:column`; a `<div>` is a block box, and
  `items-*`, `justify-*` and `gap-*` do nothing on one. Wherever a className
  relied on that default, `flex flex-col` was added — `flex flex-col` and not
  bare `flex`, because a row would be wrong for any View with more than one
  child. The visible symptom when it is missing is a spinner in the corner of
  its box, or a strip with no gaps.
- **One difference is known and deliberately not fixed.** RN's default
  `flex-shrink` is `0`; CSS's is `1`. A converted `<View>` in a flex row can
  therefore shrink where on native it could not — long text truncating, a fixed
  icon button squashing. About 50 elements have a fixed width or height inside a
  flex row with no `shrink-0`, though many are in columns or fixed-position
  contexts where it cannot happen. Adding `shrink-0` to all of them blind is as
  likely to break a layout as to fix one, and it cannot be checked without a
  gateway, so it was left alone. **If a row looks squashed or clipped on a
  narrow screen, this is the first thing to look at.**
- **Nested text needs a `<span>`.** `ui/Text` renders a `<div>`; a native
  `<Text>` nested inline. `scripts/jsx-nesting.mts` finds this — use it rather
  than reading for it. (It also prints a lot of `<div>` in `<div>`, which is
  normal; only the Text-like names matter.)
- **`pointer-events-none` on native text meant something different.** On native
  it was handed to a `<Text>` inside a `<Pressable>`, so touches fell through to
  the parent. Merged into a `<button>`'s own className — which is what the port
  did — it disables the button, and it disabled *every* button in the app while
  the typecheck, the tests and the build all stayed green. If a control is
  mysteriously unclickable, check its computed `pointer-events` before anything
  else. The descendant form, `[_svg]:pointer-events-none`, is the correct one.
- **Two lists, two strategies.** `WindowedList` (files, cron, logs) renders a
  trailing window that grows on scroll. `Transcript` (chat) is a plain scroller
  with an imperative handle, because the transcript needs scroll-position
  preservation on prepend and is already trimmed to ~600 rows by the store.
  Neither uses `@tanstack/react-virtual`; the reasoning is in each file's header.
- **Sheets are Radix dialogs** and declarative (`open` / `onOpenChange`). The
  `useSheet` hook and every `present()`/`dismiss()` dance are gone — they
  existed to work around gorhim bugs with no DOM equivalent.
- **`ScrollArea` keeps ScrollView's two boxes** (scroller + content). The inner
  box is not decoration: layouts here put `gap` on it.
- **`services/clipboard.ts` has an `execCommand` fallback** because
  `navigator.clipboard` is undefined outside a secure context and this client is
  routinely served from a plain-HTTP LAN address. Do not "simplify" it away.
- **`scripts/codemod-*.mjs` are one-shot and already run.** They are kept as the
  record of what was mechanical and what was not. Do not re-run them — one of
  them (`codemod-scroll.mjs`) had a bug that ate JSX, and three files were
  damaged before it was found and the run redone from `HEAD`.
- **`scripts/jsx-balance.mts` and `scripts/jsx-nesting.mts` are not one-shot.**
  They parse with TypeScript and are worth running after touching JSX structure.

### Deliberately dropped (see "Backlog")

Notification reply, biometric unlock, Android channel/splash/status-bar
handling, the config plugins, EAS. None had a web equivalent that was worth
faking.

## Gotchas

- **No `.env` / env vars.** The gateway host is entered by the user on the
  Login screen (placeholder `http://your-server:9119`) and persisted. Don't
  introduce `EXPO_PUBLIC_*`/`VITE_*` config for host/auth.
- **`BUILD_ID` is not hand-bumped.** `vite.config.ts` reads the git short SHA at
  build time and defines it, appending `-dirty` for an unclean tree. It shows on
  Login and Settings so a bug report can name the commit its bundle came from.
- **No password is ever written to `localStorage`.** The connect pipeline
  doesn't store one and boot calls `clearPassword`. The session cookie lives in
  the browser's own jar; `services/connection.ts` persists only the string
  `'web-jar'` as a marker. See its header comment before changing this.
- **No pull-to-refresh.** A browser has no such primitive. Every list screen has
  a refresh control in its header instead.
- **Cross-origin cookie-gated images** (the gateway's `/static/…`) are fetched
  with `credentials: 'include'` and shown as a blob URL, because a
  `SameSite=Lax` session cookie is not sent on a cross-site subresource request.
  See `components/chat/media.tsx`.

## Gateway invariants (the highest-risk area)

This app is a chat client for a gateway that runs *many* concurrent sessions —
cron jobs, background turns, other devices. Almost every subtle bug in this
codebase is a **session-routing leak**, so check these before touching
`useGateway.ts` / `useTurn.ts` / `useAskInbox.ts`:

- **Every WS event is filtered by `session_id`** against the currently open
  session (`isCurrentSession`, `src/store/slices/useGateway.ts`). Both failure
  modes are bad and look identical from the outside: *under*-filtering bleeds
  another session's tokens/tools into the open chat; *over*-filtering (an
  id-space mismatch) makes chat look **completely hung** — nothing streams, no
  bubble ever resolves. Streaming a short message successfully is the canary.
- **`session.info` from another session must not overwrite the open chat's
  model chip.**
- **Another session's `onAsk` must never hijack the current chat's ask sheet.**
  It goes to the Ask Inbox (More → Ask Inbox). If a profile or stored session
  can't be resolved, fail closed — surface it in the inbox rather than guessing
  which session owns a request.
- **Reconnect must restore `open_requests`** without duplicating inbox entries,
  and must restore locked clarify answers.
- **`stop()` must always release the local turn**, even when the session died or
  expired mid-turn, or the composer stays stuck on `generating` and the chat
  becomes unusable.
- **Todo state must survive opening a session** (restored from `todo_state`),
  not be blanked by a `setTodos([])`.
- **Edit/resend must rewind the correct session** — message row ids are
  per-session, so a stale id truncates the wrong session's history.
- **Logout must fully reset composer state** (no stuck Stop button, queue,
  todos, attachments, or pending asks).

**When chat appears hung, log before guessing.** Add a temporary log of `sid` in
`GatewayWs.dispatch` (`src/services/gateway-ws.ts`) and of `event_sid` vs
`sessionIdRef.current` in `isCurrentSession`, then compare: matching ids mean the
filter is fine and the bug is elsewhere; ids that never match mean the id spaces
differ. Remove the logs before committing.

Manual regression passes need a real gateway — you cannot self-serve them. If
you change the gateway, sessions, or the turn engine, state explicitly which of
the above a human should re-verify.

## Backlog

Ported out, not ported over. Each is a real feature regression, not a bug.

- **Notification reply.** The browser Notification API cannot carry action
  buttons, so an ask can no longer be answered from the notification itself —
  it has to be opened in the Ask Inbox. Answering it without opening the app
  needs a Service Worker plus server-side Web Push. The invariant it used to
  hold — a reply uses the original request id exactly once, and is deferred
  never dropped or misrouted — is the invariant the replacement must satisfy.
  `store/helpers.ts` notes where its dedup key used to live.
- **Biometric unlock.** The native build gated a *stored* password behind
  `expo-local-authentication`. There is no stored password to gate any more, and
  the browser equivalent is a passkey (WebAuthn) with a server-side challenge —
  a different mechanism, not a port. Login's "Unlock with biometrics" button is
  gone.

## Scope

Deliberately **not** implemented here (the desktop client has them; their absence
is a decision, not a bug): multi-connection routing, skills hub / install /
learned editing, MCP editing / test / OAuth, plugins management, toolset &
provider configuration, git review / commit / push, native PTY / terminal,
browser preview, split panes / multi-window, and a workspace tree (Files is a
**server file browser**, not a workspace tree). Before adding a feature,
confirm it belongs to this client rather than being a desktop-only concern.

## Conventions

- Commits are Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`,
  `docs:`) with a scope where it helps, e.g. `fix(chat): stop clipping the model
  name on wide screens`.
- The codebase is written for a human reader: dense, explanatory comments
  explain *why* a non-obvious choice was made, not what the line does. Keep that
  bar when editing.
- `docs/` is gitignored — a local working-notes folder, not repo content. If you
  find one there it may be stale. **Trust `src/` over any doc.**

## Not in version control

`.openchamber/` holds agent tooling output (browser-panel screenshots).
