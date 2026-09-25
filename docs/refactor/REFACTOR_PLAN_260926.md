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
- [~] Phase 4c — added `src/store/runtime.ts` (`useStoreRuntime`) centralizing the cross-slice refs, destructured back into the provider under the same names. Extracted slices (13): theme, notifications, queue, models, sessionInfo, liveRoster, composer, sessions, askInbox, askReplies, notificationResponses, toolRefresh, liveTurn. The "slice owns refs/setters, provider gets them back for direct writes" technique keeps lifecycle resets untouched. `app-store.tsx` is down to ~3.0k (from 4489, −33%).

The residual is the **orchestrator** — `connect`/`login`/`logout`, `switchProfile`, session management (`openSession`/`newSession`/`branchSession`/…), the turn engine (`beginTurn`/`send`/`stop`/`runSlash`), and `openWs` (~470 lines). Each of these touches 20–40 pieces of state/refs across the slices (they are the app's orchestration, not a leaf concern). Extracting them into a final "orchestrator slice" mostly relocates code behind a very large deps object, so it should be done **with the app running** to catch behavioural regressions; typecheck + the pure-logic tests cannot cover them.
- [x] Tests — added `src/utils/format.test.mjs` plus `helpers.test.mjs` for logs/cron/usage; extended the `test` glob to `src/screens/*/*.test.mjs`. Suite is 71 passing (was 57).
- [ ] Phase 5
