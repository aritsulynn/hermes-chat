# Refactor plan — hermes-mobile (2026-09-26)

Baseline: `npm run typecheck` green, `npm test` = 57 pass. Checkpoint commit:
`ee2a15b feat: add server update panel and harden connection/media paths`.

Scope: reduce file size / improve navigability. Note that most "organize" work
is **relocation** (same total LOC, smaller files); real LOC reduction comes from
dead-code removal + de-duplication only.

---

## A. Dead / unnecessary code

| # | Target | Evidence | Lines saved |
|---|--------|----------|-------------|
| A1 | `src/screens/ops/index.tsx` (whole file) | Replaced by per-screen routes in `cfc53f0`; no `/ops` route, no importer of `OpsScreen`/`OpsTab`. **Needs decision:** route it or delete it (it was kept in sync with `lib/api.ts`). | ~275 |
| A2 | `fuzzyScoreMulti` + `fuzzyRank` in `utils/fuzzy.ts` | No callers (chat only uses `fuzzyScoreMultiTokens`). | ~64 |
| A3 | `onNotificationTap` in `lib/notifications.ts` | No callers. | ~10 |
| A4 | Unused store keys: `answerInboxValue`, `closeCurrent`, `getConnectionEpoch`, `jumpToRecent`, `setEffort`, `toggleTheme` | Zero references outside `app-store.tsx` (incl. `.mjs`). | ~40–60 |
| A5 | Needless `export` on ~60 internal-only symbols | e.g. `stripAnsi`, `searchFold`, `normalizeBase`, `mergeCookies`, `getSetCookies`, `apiGet`/`apiMut`, `mediaExt`/`mediaKind`, `KANBAN_BASE`, `renderBackdrop`. | 0 (API shrink) |

## B. Duplicated code

| # | Item | Detail |
|---|------|--------|
| B1 | Number formatters | `formatTokens` (usage) + `formatTokensCount` (cron) duplicate `compactNumber` (`utils/format.ts`). |
| B2 | Date/bytes/money formatters | `formatBytes`+`formatDate` (files), `formatDateTime`+`formatRunTime`+`formatRunDuration` (cron), `formatCost`+`formatDayLabel` (usage) → consolidate into `utils/format.ts`. |
| B3 | `components/index.ts` barrel | Exports all 7 modules; risk of circular imports / worse tree-shaking. Prefer direct imports. |

## C. Target structure

```
src/
  app/                     # expo-router routes (thin re-export) — unchanged
  store/
    provider.tsx           # AppProvider = compose slices
    context.ts             # createContext + useApp
    types.ts               # AppStore split by domain
    runtime.ts             # shared refs (gw, cookie, epoch) passed to slices
    helpers/               # pure helpers (withTimeout, historyToItems, ...)
    slices/                # one hook per domain (see Phase 4)
  features/                # one folder per screen (renamed from screens/)
    chat|files|cron|usage|logs|kanban|asks|skills|toolsets|settings|login/
      index.tsx  components/  helpers.ts  types.ts  constants.ts
  components/
    ui/                    # bits, sheets
    chat/                  # composer, message-bubble, markdown, media
  services/                # transport only (renamed from lib/)
  utils/                   # pure + types
```

## D. Phases

### Phase 0 — Guardrails
- Baseline typecheck/test green (done).
- No lint/prettier config exists yet; add if desired.

### Phase 1 — Remove dead code (safe)
- A2, A3 (delete dead functions), A4 (drop unused store keys), A5 (un-export).
- A1 decided separately by the user.

### Phase 2 — Consolidate formatters
- Move B1/B2 formatters into `utils/format.ts`; update call sites.

### Phase 3 — Split large screens (no store changes)
| Screen | Extract | Lines moved |
|--------|---------|-------------|
| chat (1842) | `ChatHeader`, `ChatSearchHeader`, `helpers` | ~175 |
| cron (1335) | `types`, `helpers`, `JobPromptPreview` | ~225 |
| files (1174) | `types`, `helpers`, `FileRow` | ~245 |
| usage (613) | `helpers`, `DayBar` | ~115 |
| kanban (651) | `types`, `helpers`, `CardChips` | ~90 |
| logs (593) | `constants` | ~57 |
| _layout (794) | `drawer/HermesDrawerContent`, `drawer/nav-config` | ~560 |

### Phase 4 — Split `app-store.tsx` (4489)
- 4a: module-level helpers (237–505) → `store/helpers/`.
- 4b: `AppStore` type (95–232) → `store/types.ts`.
- 4c: slices in dependency order: theme → queue → attachments → asks/notifications
  → models → sessions → transcript/streaming → gateway/connection.
- Key risk: `openWs` (1485–1955, a ~470-line callback). Extract via shared
  `store/runtime.ts` refs.

### Phase 5 — Folder/name reorg (optional)
`lib`→`services`, `screens`→`features`, split `components`, drop barrel.

## E. Guardrails
- typecheck + test after every phase/slice; one commit per slice.
- Phase 4 is strictly incremental — no big-bang.
- Verify A4/A5 intent before deleting (no callers found, but confirm not public API).

## Progress log
- [x] Phase 1 — removed `screens/ops`, `fuzzyScoreMulti`/`fuzzyRank`, `onNotificationTap`, and 6 unused store keys (`setEffort`/`toggleTheme`/`closeCurrent`/`jumpToRecent`/`getConnectionEpoch` as public API; `answerInboxValue` exposure). A5 (un-export) deferred as low value.
- [x] Phase 2 — centralized display formatters in `utils/format.ts` (`formatBytes`, `formatDate`, `toEpochMs`, `formatDateTime`, `formatRunTime`, `formatRunDuration`, `formatCost`, `formatDayLabel`); usage/cron number formatters now use `compactNumber`.
- [ ] Phase 3
- [x] Phase 3 — split chat (1842→1645), cron (1335→1114), and files (1174→926) into `components/`, `helpers.ts`, `types.ts`. usage (589→507), kanban (651→561), logs (593→537) split too; _layout drawer extraction still pending.
- [x] Phase 4a/4b — extracted `AppStore`/`AgentProfile`/`ScopedSessionSummary` to `src/store/types.ts` and all module-level helpers to `src/store/helpers.ts`; `app-store.tsx` 4489→3978.
- [~] Phase 4c — added `src/store/runtime.ts` (`useStoreRuntime`) centralizing the cross-slice refs, destructured back into the provider under the same names. Extracted slices (14): theme, notifications, queue, models, sessionInfo, liveRoster, composer, sessions, askInbox, askReplies, notificationResponses, toolRefresh, liveTurn, commands. The "slice owns refs/setters, provider gets them back for direct writes" technique keeps lifecycle resets untouched. `app-store.tsx` is down to ~2.97k (from 4489, −34%).

Residual = the **orchestrator** — `connect`/`login`/`logout`, `switchProfile`, session management, the turn engine, and `openWs` (~477 lines). Two concrete reasons it was not split further:

1. **Leaf slices depend on orchestrator state**, so the orchestrator must create them (e.g. `useModelsSlice` needs `host`/`sessionId`/`setMessages`; `useSessionInfoSlice` needs `sessionId`). Pulling the orchestrator into its own hook means the leaf slices move with it.
2. **`openWs` closes over ~50 symbols** (every setter + ref + the ask/notification/live-turn callbacks). Its `useCallback` deps are only the 6 stable callbacks, because everything else is a stable setter/ref — but extracting it would require a ~50-entry deps object. This is not "organizing", it is trading a long file for a very wide interface; the right fix is a redesign where mutable state lives behind a shared `store` object (refs + setters) that slices read, instead of threading deps.

As a safe, behaviour-preserving finish, the orchestrator body was relocated verbatim from `hooks/app-store.tsx` to `store/useAppStore.tsx`, and `hooks/app-store.tsx` is now a 7-line entry that re-exports `useApp`/`AppProvider` (import paths unchanged for all callers).

### Final shape
```
src/hooks/app-store.tsx      # 7 lines — entry, re-exports useApp/AppProvider
src/store/useAppStore.tsx    # ~1230 lines — composition + context value only
src/store/runtime.ts         # shared refs (incl. orchestrator refs)
src/store/helpers.ts         # pure helpers
src/store/types.ts           # AppStore contract + profile/session types
src/store/slices/*           # 20 slices
```

The orchestrator was fully split using the "slice owns state/refs, provider
passes a deps object, refs returned for direct writes" technique. The 20 slices:

**Leaf/domain:** theme, notifications, queue, models, sessionInfo, liveRoster,
composer, sessions, askInbox, askReplies, notificationResponses, toolRefresh,
liveTurn, commands.

**Orchestrator:** gateway (openWs + WS helpers), connection (connect/login/
logout), sessionOps (openSession/newSession), profileOps (switchProfile/
branchSession), turn (beginTurn/send/stop/runSlash/pasteLarge/…),
sessionMisc (rename/delete/redirect/setGlobalModel).

Cross-cutting refs (`sessionIdRef`, `connectRef`, `openSessionRef`,
`releaseLocalTurnRef`, …) live in `store/runtime.ts` to break ordering cycles.
`useAppStore` now only declares hook state, calls the slices, wires the
boot/watchdog effects, and builds the context value.
- [x] Tests — added `src/utils/format.test.mjs` plus `helpers.test.mjs` for logs/cron/usage; extended the `test` glob to `src/screens/*/*.test.mjs`. Suite is 71 passing (was 57).
- [ ] Phase 5
