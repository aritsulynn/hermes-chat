# Hermes Mobile — Feature Parity Roadmap

> Working document. Use it to pick the next feature to port — especially the small ones.
> Last updated: 2026-10-02

## Context

This repo (`hermes-mobile-react-migration`) is the **mobile client** for Hermes Agent.
The complete desktop dashboard lives at **`~/.hermes/hermes-agent/web/`** and shares
almost the same stack, so it is the reference implementation:

| | Desktop `~/.hermes/hermes-agent/web/` | Mobile (this repo) |
| --- | --- | --- |
| Framework | React 19 + Vite + react-router 8 | React 19 + Vite + react-router-dom 7 |
| Styling | Tailwind v4 | Tailwind v4 |
| Design system | `@nous-research/ui` | Base UI + `src/components/ui/*` |
| Transport | `src/lib/api.ts` (2,882 lines) | `src/services/api.ts` (201) + `services/dashboard.ts` |
| i18n | 20 locales (`src/i18n/`) — **no Thai** | none |

**Porting caveat:** you cannot copy files wholesale — the two apps use different
design systems. Copy the *logic/state* from the reference and re-skin it as mobile UI.
Pure logic under `web/src/lib/*.ts` (e.g. `schedule.ts`) is nearly drop-in.

## How to read this document

- **Status** — `done` / `partial` / `missing`
- **Size** — `S` = half a day, `M` = 1–2 days, `L` = several days
- Each item lists: the endpoint that already exists, the reference file, and the
  mobile files to touch.

The mobile app already has helpers, so adding an endpoint is fast:

- `opsGet(path)` / `opsMut(path, method, body)` in `src/services/dashboard.ts`
- all path builders live in `src/services/api.ts`
- add a screen: `src/features/<name>/index.tsx` → wire it in `src/routes.tsx`
  and register it in `src/components/drawer/nav-config.tsx`
  (`NAV_ITEMS` / `MORE_NAV_ITEMS`)

---

## 1. Features the mobile app already has

| Route | Screen | Status |
| --- | --- | --- |
| `/chat` | Chat (streaming, tools, todos, composer) | done |
| `/asks` | Ask Inbox | done |
| `/cron` | Cron CRUD + run history | done (no schedule builder) |
| `/files` | File browser + preview | partial (read-only) |
| `/kanban` | Task board | done |
| `/logs` | Gateway logs | done |
| `/skills` | Skill inventory + toggle + viewer | partial (cannot edit/install) |
| `/toolsets` | Enable/disable toggle | partial (cannot configure) |
| `/usage` | Token/cost by day | done (incomplete) |
| `/settings` | theme, approvals, profiles, update, notifications | done |

## 2. Parity map vs desktop

| Feature | Desktop route | Reference | Mobile | Size |
| --- | --- | --- | --- | --- |
| Session export | `/sessions` | `SessionsPage.tsx` | missing | S |
| Schedule builder (cron) | `/cron` | `lib/schedule.ts` + `ScheduleBuilder.tsx` | missing | S–M |
| Analytics by model | `/analytics` | `AnalyticsPage.tsx` | partial | S |
| Skill editor | `/skills` | `SkillEditorDialog.tsx` | missing | M |
| Skill hub (search/install) | `/skills` | `SkillsPage.tsx` | missing | M |
| Toolset config | — | `ToolsetConfigDrawer.tsx` | missing | M |
| Files write/delete/download | `/files` | `FilesPage.tsx` | missing | M |
| Reasoning picker | `/chat` | `ReasoningPicker.tsx` | missing | S–M |
| Session search | `/sessions` | `SessionsPage.tsx` | missing | M |
| Models (aux / MoA) | `/models` | `ModelsPage.tsx` | partial | M–L |
| MCP | `/mcp` | `McpPage.tsx` | read-only | L |
| Channels | `/channels` | `ChannelsPage.tsx` | missing | L |
| System / Ops | `/system` | `SystemPage.tsx` | missing | L |
| Profiles (CRUD) | `/profiles` | `ProfilesPage.tsx` | partial | L |
| Config | `/config` | `ConfigPage.tsx` | missing | L |
| Keys / Env | `/env` | `EnvPage.tsx` | missing | L |
| Plugins | `/plugins` | `PluginsPage.tsx` | missing | L |
| Pairing | `/pairing` | `PairingPage.tsx` | missing | M |
| Webhooks | `/webhooks` | `WebhooksPage.tsx` | missing | M |
| Timeline / branch view | `/sessions` | `SessionsPage.tsx` | missing | M |
| i18n + Thai | whole app | `src/i18n/` | missing | L |

---

## 3. Easy wins — start here

### 3.1 Session export `S`

- **What:** export a conversation to a file from the chat screen.
- **Endpoint:** `GET /api/sessions/{id}/export`
- **Reference:** `web/src/lib/api.ts` (response shape), `SessionsPage.tsx`
- **Touch:** `src/services/api.ts` (add a builder), `src/features/chat/index.tsx`
  (existing menu); reuse `services/clipboard.ts` where useful.
- **Note:** no new screen needed — hang it off the chat menu.

### 3.2 Cron ScheduleBuilder `S–M`

- **What:** replace the raw cron-expression field with a human-readable builder
  (hourly / daily / weekly / interval / custom).
- **Endpoint:** existing (`POST/PUT /api/cron/jobs`) — no backend change.
- **Reference:** `web/src/lib/schedule.ts` (465 lines, pure logic, near drop-in)
  + `web/src/components/ScheduleBuilder.tsx` (273).
- **Touch:** `src/features/cron/index.tsx` — today it uses `formSchedule` +
  `SCHEDULE_PRESETS` from `src/features/cron/helpers.ts`; the input is around line 1007.
- **Note:** there is a test at `lib/schedule.test.ts` — port it too.

### 3.3 Analytics by model `S`

- **What:** add a per-model usage breakdown (today there is only the daily chart plus
  `by_model` from `/analytics/usage`).
- **Endpoint:** `GET /api/analytics/models?days=`
- **Reference:** `AnalyticsPage.tsx`
- **Touch:** `src/features/usage/index.tsx`, `src/services/api.ts`

### 3.4 Reasoning picker `S–M`

- **What:** choose reasoning effort per model in the chat screen.
- **Endpoint:** existing (`/api/model/options` already returns `capabilities.reasoning`).
- **Reference:** `web/src/components/ReasoningPicker.tsx` (117), `lib/reasoning-effort.ts`
- **Touch:** mobile chat header / model picker.
- **Note:** mobile already has part of this in `utils/reasoning.ts` — check first.

### 3.5 Session search `M`

- **What:** search message content across sessions (today the sidebar only filters
  title/preview of already-loaded sessions).
- **Endpoint:** `GET /api/sessions/search?q=`
- **Reference:** `SessionsPage.tsx`
- **Touch:** `src/components/drawer/HermesSidebarContent.tsx`, or a new `/sessions` screen.
- **Note:** commit `drop conversation search` removed this once — find out why first.

---

## 4. Medium

### 4.1 Skill editor `M`
- `PUT /api/skills/content`, `POST /api/skills`
- Reference: `SkillEditorDialog.tsx` (216)
- Touch: `src/features/skills/index.tsx`, `src/services/api.ts`

### 4.2 Skill hub — search/install skills `M`
- `GET /api/skills/hub/search?q=&source=&limit=`, `/sources`, `/preview?identifier=`, `/scan`
- `POST /api/skills/hub/install|uninstall|update`
- Reference: `SkillsPage.tsx`

### 4.3 Toolset config `M`
- `GET /api/tools/toolsets/{name}/config`, `/models`
- `PUT /api/tools/toolsets/{name}/model|provider|env`, `POST .../post-setup`
- Reference: `ToolsetConfigDrawer.tsx` (460)
- Touch: `src/features/toolsets/index.tsx` (today only `getToolsets` / `setToolsetEnabled`)

### 4.4 Files write/delete/download `M`
- `POST /api/fs/write-text`, `DELETE /api/files`, `GET /api/files/download`,
  `GET /api/files/stream`, `POST /api/files/upload-stream`
- Reference: `FilesPage.tsx` (526)
- Touch: `src/features/files/index.tsx`, `src/services/api.ts`

### 4.5 Pairing `M`
- `GET /api/pairing`, `POST /api/pairing/approve|revoke|clear-pending`
- Reference: `PairingPage.tsx` (274)

### 4.6 Webhooks `M`
- `GET /api/webhooks`, `POST /api/webhooks/enable`, `POST /api/webhooks`,
  `DELETE /api/webhooks/{name}`, `PUT /api/webhooks/{name}/enabled`
- Reference: `WebhooksPage.tsx` (613)

### 4.7 Timeline / branch view `M`
- `GET /api/sessions/{id}/timeline`, `/latest-descendant`, `/messages/around`
- Reference: `SessionsPage.tsx`

---

## 5. Large — full new screens

| Screen | Reference | Main endpoints | Size |
| --- | --- | --- | --- |
| MCP | `McpPage.tsx` (917) | `/api/mcp/servers`, `/api/mcp/catalog`, `/api/mcp/catalog/install`, `/api/mcp/servers/{n}/test`, `/auth` | L |
| Channels | `ChannelsPage.tsx` (1460) + `PlatformsCard.tsx` | `/api/messaging/platforms`, `.../test`, `telegram/whatsapp/onboarding/*` | L |
| System / Ops | `SystemPage.tsx` (1649) | `/api/health`, `/api/system/stats`, `/api/gateway/start\|stop`, `/api/credentials/pool`, `/api/ops/*` | L |
| Profiles | `ProfilesPage.tsx` (1426) + `ProfileBuilderPage.tsx` | `/api/profiles*` (CRUD, soul, export/import) | L |
| Config | `ConfigPage.tsx` (680) | `/api/config`, `/config/raw`, `/config/schema` | L |
| Keys / Env | `EnvPage.tsx` (1109) | `/api/env`, `/api/providers/*` | L |
| Plugins | `PluginsPage.tsx` (1401) | `/api/dashboard/plugins*` | L |
| Full Models | `ModelsPage.tsx` (1368) | `/api/model/info`, `/auxiliary`, `/moa`, `/recommended-default` | M–L |
| i18n + Thai | `src/i18n/` | — | L |

> **Channels + QR pairing** (Telegram/WhatsApp) is the most mobile-native item in
> this group — the desktop has to scan a QR code in front of the machine, a phone
> can just do it.

---

## 6. Endpoints the backend already has that mobile does not call

Proof that no backend work is needed:

```
/api/analytics/models          /api/config, /config/raw, /config/schema, /config/defaults
/api/chat/workspaces           /api/credentials, /api/credentials/pool
/api/cron/blueprints[/instantiate]  /api/curator[/paused, /run]
/api/dashboard/plugins[/catalog, /hub, /rescan, /agent-plugins]
/api/env, /api/env/reveal      /api/files/download, /stream, /upload-stream
/api/fs/write-text, /fs/list, /fs/read-text, /fs/git-root
/api/gateway/start, /stop, /migrate[/plan]
/api/local-models              /api/mcp/*
/api/memory[/provider, /providers, /reset]
/api/messaging/*               /api/model/info, /auxiliary, /moa, /recommended-default
/api/ops/doctor, /security-audit, /backup[/download], /import[-upload],
        /hooks, /checkpoints[/prune], /prompt-size, /dump, /debug-share, /config-migrate
/api/pairing*                  /api/profiles/{name}/soul, /description, /model, /export, /import
/api/sessions/search, /stats, /bulk-delete, /empty, /import, /prune,
        /{id}/export, /timeline, /latest-descendant, /messages/around
/api/skills/hub/*              /api/system/stats, /api/host/identity
/api/tools/toolsets/{n}/config, /models, /model, /provider, /env, /post-setup
/api/tools/terminal/backends   /api/webhooks*
```

## 7. Porting + verification steps

1. Open the reference at `~/.hermes/hermes-agent/web/src/...` and read the logic.
2. Add a path builder in `src/services/api.ts`.
3. Build the UI in `src/features/<name>/` using Base UI + `components/ui/*`.
4. Wire the route: `src/routes.tsx` + `src/components/drawer/nav-config.tsx`.
5. Verify: `npm run typecheck` and `npm test` (both must be green).
6. Anything touching sessions or the turn engine also needs a manual pass against a
   real gateway (see README).
