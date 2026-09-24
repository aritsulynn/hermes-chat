# Hermes Mobile ↔ Hermes Desktop Feature Parity Audit

> เปรียบเทียบจาก source code ของ Hermes Mobile และ Hermes Desktop
> วันที่ตรวจ: 2026-09-24
> สถานะ: static source audit + P0 vertical slice — รัน typecheck, Node tests และ web bundle แล้ว; ยังรอ native device test และ gateway integration test

## ขอบเขต

- **Mobile**: `/home/lynn/workspace/hermes-mobile`
- **Desktop**: `/home/lynn/.hermes/hermes-agent/apps/desktop`

คำว่า “มีฟีเจอร์” ในเอกสารนี้หมายถึงมี route, component, API contract, store หรือ handler ที่ยืนยันได้จาก source ไม่ได้หมายความว่าผ่าน runtime integration test แล้ว

## สรุปผู้บริหาร

Hermes Mobile มี **core chat parity ระดับสูง** กับ Desktop โดยเฉพาะ:

- dashboard authentication และ WebSocket ticket
- JSON-RPC streaming
- reasoning และ tool lifecycle
- todo, context และ usage
- approval / clarify
- queue / steer
- stop
- edit / resend / regenerate / branch
- attachments
- model/provider selection
- profile-aware sessions

แต่ Mobile ยังไม่ใช่ full Desktop parity เพราะ Desktop ทำหน้าที่เป็นทั้ง chat client, operations console และ development workspace ในขณะที่ Mobile เน้น **foreground chat บนโทรศัพท์**

ความต่างที่สำคัญที่สุดคือ:

1. Desktop รองรับหลาย session/background session และ owner routing
2. Desktop รองรับหลาย connection/profile/backend
3. Desktop มี management surface สำหรับ MCP, Plugins, Models, Profiles และ Git
4. Desktop มี native workspace features เช่น PTY, split panes และ browser preview

## Feature matrix

| ด้าน | Hermes Mobile | Hermes Desktop | สถานะ |
|---|---|---|---|
| Streaming assistant response | มี | มี | ✅ |
| Reasoning / thinking | มี | มี | ✅ |
| Tool start/progress/complete | มี | มี | ✅ |
| Tool result และ inline diff | มี | มี | ✅ |
| Todo / context / usage | มี | มี | ✅ |
| Approval / clarify / sudo / secret / vault | มี | มี | ✅ สำหรับ session ที่เปิดอยู่ |
| Edit / resend | มี | มี | ✅ |
| Regenerate / branch | มี | มี | ✅ |
| Queue / steer | มี | มี | ✅ |
| Attachments | มี | มี | ✅ แต่ Mobile มีข้อจำกัดขนาด/จำนวนไฟล์ |
| Session list / profile | มี | มี | ✅ |
| Background session แบบ concurrent | ยังไม่ครบ | มี | ◐ / — |
| Multi-connection routing | ยังไม่มี | มี | — |
| Skills inventory | มี | มี | ✅ |
| Skills Hub / install / learned editing | ยังไม่มี | มี | — |
| Toolsets toggle | มี | มี | ✅ |
| Toolset configuration / provider setup | ยังไม่มี | มี | — |
| MCP management | มี status summary | มี editor/test/OAuth/reload | — |
| Plugins management | ไม่มี | มี | — |
| Files | มี server file browser | มี workspace tree | ◐ |
| Git review / commit / push / PR | ไม่มี | มี | — |
| Cron | มี CRUD/run/pause/resume | มี blueprint/delivery controls เพิ่ม | ◐ |
| Kanban | มี CRUD/move/detail พื้นฐาน | มี drag/drop/comments/orchestration | ◐ |
| Usage | มี | มีผ่าน Command Center | ✅ |
| Logs | มีแยกหน้า | รวมใน Command Center | ✅ |
| Settings | เน้น mobile basics | configuration กว้างและลึกกว่า | ◐ |
| Model/provider picker | มี | มี | ✅ |
| Fallback/auxiliary/MoA/local models | ยังไม่มี | มี | — |
| Slash server commands | มีหลายส่วน | มีครบกว่า | ◐ |
| Native PTY / terminal | ไม่มี | มี | Native-only |
| Browser preview | มีเฉพาะ rendering/deep-link | มี in-app browser/action | ◐ |
| Split panes / multi-window | ไม่มี | มี | Native-only |
| Biometric unlock | มี | ไม่ใช่ mobile feature | ✅ Mobile-only |
| Local background notification | มี | มีฝั่ง native ของ Desktop | ✅ / ◐ |

## ส่วนที่ Mobile มี parity แล้ว

### Chat และ gateway protocol

Mobile ใช้ dashboard REST + WebSocket JSON-RPC ตาม contract เดียวกับ Desktop:

```text
GET /api/status
→ POST /auth/password-login
→ session cookie
→ POST /api/auth/ws-ticket
→ WebSocket /api/ws?ticket=...
```

Mobile รองรับ:

- heartbeat
- reconnect และ exponential backoff
- refresh WS ticket ก่อน reconnect
- duplicate-event filtering
- missed-event replay
- REST resync เมื่อ replay ถูกตัด
- session cookie โดยไม่ส่ง Authorization header
- current session filtering

แหล่งอ้างอิงหลัก:

- `src/lib/dashboard.ts`
- `src/lib/gateway-ws.ts`
- `src/hooks/app-store.tsx`

### Chat lifecycle

Mobile รองรับ foreground chat workflow ที่ครอบคลุม:

- streaming token
- reasoning
- interim status
- tool start/progress/complete
- REST tool-result backfill
- inline diff
- todo list
- context/token/cost
- subagent summary
- approval/clarify sheet
- queue ระหว่าง turn
- steer turn ที่กำลังรัน
- stop
- edit/resend
- regenerate
- branch
- slash completion
- `@` references
- image/document attachment staging

### Slash commands

Mobile ไม่ได้จำกัดอยู่แค่ `/new`, `/stop`, `/title` เพราะใช้ live `commands.catalog` จาก backend ได้ด้วย

สิ่งที่ Mobile ทำเองมีเพียง local actions หลัก ๆ เช่น:

- `/new`
- `/stop`
- `/title`

ส่วน Desktop มี local action/picker surface มากกว่า Mobile ตั้งใจซ่อนหรือ block command ที่ไม่มี mobile equivalent เช่น `/handoff`, `/btw`, `/wake`, voice และ terminal/messaging-only commands

แหล่งอ้างอิง:

- `src/utils/slash-commands.ts`
- `src/hooks/app-store.tsx`

## Gap สำคัญ

### P0 — Background ask และ session ownership

> **สถานะ: ทำ vertical slice แล้ว (2026-09-24)** — ยังไม่ถือว่าเท่ากับ Desktop เต็มรูปแบบ

Mobile ยังใช้โมเดล foreground-first สำหรับ transcript และไม่ถอด event filter ของ token/tool/complete ออก เพื่อไม่ให้ transcript ปนระหว่าง session แต่ server ask ไม่ได้ถูก ignore อีกต่อไป

สิ่งที่ทำแล้ว:

- เพิ่ม global ask inbox ที่ `src/lib/ask-inbox.ts`
- เก็บ owner metadata: connection, profile, stored session และ runtime session
- เก็บ ask ทุก session โดยไม่ hijack AskSheet ของ session ปัจจุบัน
- เพิ่มหน้า `More → Ask Inbox` ที่ `src/app/asks.tsx`
- รองรับ Allow once / Reject / Answer จาก notification บน native โดย approval action ต้องผ่าน local authentication
- แยก notification category ของ secret/vault ให้เปิดแอปเท่านั้น ไม่รับ secret จาก lock screen
- ผูก notification data กับ ask key และ RPC ID
- ทำ response แบบ one-shot กันตอบซ้ำ
- ดู `open_requests` จาก `session.resume` และ `session.events.since`
- sync open requests จาก live sessions ที่ `status === waiting`
- เก็บสถานะ pending / sent (ยังไม่ยืนยันจาก gateway) / answered / cancelled และ re-arm ได้เมื่อ `open_requests` ยืนยันว่ายังเปิดอยู่
- แจ้งเตือน background completion แม้ transcript ไม่ได้เปิดอยู่

แหล่งอ้างอิง:

- `src/lib/ask-inbox.ts`
- `src/lib/gateway-ws.ts`
- `src/lib/notifications.ts`
- `src/hooks/app-store.tsx`
- `src/screens/asks/index.tsx`
- `src/app/asks.tsx`

Desktop ใช้ per-session state และ scoped server requests เช่นกัน:

- เก็บ ask ของแต่ละ session
- flag session ว่า `needsInput`
- แสดง notification action สำหรับ approve/reject
- ตอบ request ผ่าน owner ที่ถูกต้อง
- route request ไปยัง session tile ที่เปิดอยู่

แหล่งอ้างอิง Desktop:

- `apps/desktop/src/app/session/hooks/use-message-stream/gateway-event/server-requests.ts`
- `apps/desktop/src/store/server-requests.ts`
- `apps/desktop/src/store/session-request-router.ts`

### สิ่งที่ยังต้องทำต่อใน P0/P0.5

- ถ้า background session มาจาก profile ที่ยัง resolve ไม่ได้ ระบบ fail closed และให้เปิด inbox แทนการเดา profile
- background completion ยังไม่มี full session tile/status timeline เหมือน Desktop
- local notification action ต้องพึ่ง gateway reconnect; ถ้า process ถูกปิดหรือ socket ไม่พร้อมจะยังตอบแบบ headless ไม่ได้
- `clarify.lock` และ exact multi-profile navigation ควรย้ายไปใช้ owner router โดยตรง
- broader client prompt-queue semantics และ async branch/delete transition hardening ยังเป็นงานต่อเนื่องนอก ask-inbox slice

## Route coverage

### Mobile routes ที่เปิดใช้งานได้

จาก `src/app/_layout.tsx`:

```text
/chat
/cron
/kanban
/asks
/skills
/toolsets
/logs
/usage
/files
/settings
/login
```

### Desktop routes

จาก `apps/desktop/src/app/routes.ts`:

```text
/
/:sessionId
/settings
/command-center
/capabilities
/messaging
/webhooks
/artifacts
/cron
/profiles
/agents
/starmap
/session-import
```

Mobile มี `More → Ask Inbox` เป็น surface สำหรับ background asks และ notification routing

Desktop มี route ด้าน management และ automation ที่ Mobile ยังไม่มี:

- Command Center
- Messaging / Telegram pairing
- Webhooks
- Artifacts gallery
- Profiles / SOUL
- Agents
- StarMap
- Session Import
- contributed plugin routes

### Ops screen ที่ยังไม่ได้เปิดใช้งาน

มี `src/screens/ops/index.tsx` อยู่จริง และครอบคลุม cron, kanban, logs, usage และ files แต่ไม่มี:

- `src/app/ops.tsx`
- `Drawer.Screen` สำหรับ `ops`

ดังนั้น `/ops` ไม่ใช่ route ที่ผู้ใช้เปิดได้ในปัจจุบัน

## Capabilities

Desktop รวม capability management ไว้ใน `/capabilities` หน้าเดียว:

```text
Capabilities
├── Skills
├── Toolsets
├── MCP
└── Plugins
```

Mobile แยก Skills และ Toolsets เป็น route ต่างหาก และมี MCP เพียง status summary ใน Settings

### Navigation decision

ไม่ใช้หน้า `/capabilities` hub และไม่เพิ่ม `Capabilities` เป็นหัวข้อระดับบนสุดของ Drawer แต่จะวางหน้าจอแต่ละชนิดไว้ใต้หัวข้อ **More** โดยตรง:

```text
More
├── Kanban
├── Ask Inbox
├── Skills
├── Toolsets
├── MCP
└── Plugins
```

`Ask Inbox` เป็น surface สำหรับ background asks ส่วน `Skills` และ `Toolsets` ใช้หน้าจอ/routes เดิมของ Mobile และ `MCP`/`Plugins` เป็นหน้าจอใหม่ที่จะเพิ่มภายหลัง ทั้งหมดต้องเปิดจาก submenu ของ More และไม่ต้องมีหน้า Capabilities รวมอีกชั้นหนึ่ง

### Skills

Mobile มี:

- list installed skills
- enable/disable
- origin/usage
- อ่าน `SKILL.md`

Desktop มีเพิ่ม:

- Skills Hub
- install/update
- bulk enable/disable
- learned skill editing
- archive/restore
- profile-scoped operations

### Toolsets

Mobile มี:

- list/search
- enable/disable
- configured/ready status

Desktop มีเพิ่ม:

- toolset configuration
- provider/model selection
- per-tool setup
- bulk actions
- usage/detail information

### MCP / Plugins

Mobile ยังไม่มี management UI สำหรับ:

- MCP catalog/install
- MCP editor
- test/probe
- OAuth
- per-tool filtering
- enable/disable
- reload
- plugin install/update/remove

## Files และ Git

Mobile เป็น server-managed file browser:

- browse directory
- breadcrumb
- create file/folder
- edit text
- delete
- upload image
- preview image/text
- copy content
- binary/unsupported preview notice

Desktop เพิ่ม:

- project/worktree context
- workspace file tree
- diff review
- stage/unstage
- revert
- commit
- push
- PR
- local file reveal
- persistent terminal

Mobile ควรผูก Files กับ `session.cwd` และทำ mobile review workflow แทนการ copy desktop side panel ทั้งหมด

## Models และ Settings

Mobile มี:

- model/provider picker
- session-scoped model
- global default model
- reasoning effort
- fast mode
- profile-aware persistence
- model search

Desktop มีเพิ่ม:

- fallback models
- auxiliary task model
- MoA presets
- provider account/OAuth
- API key
- custom endpoint
- local model management
- context length

Mobile Settings ปัจจุบันเน้น mobile basics:

- theme
- account/server
- active profile
- approval mode
- notification
- diagnostics
- MCP status
- logout

Desktop มี configuration ที่กว้างกว่ามาก

## Cron และ Kanban

### Cron

ทั้งสองฝั่งมี:

- list
- create/edit
- delete
- run now
- pause/resume
- run history
- เปิด run เข้า chat

Desktop เพิ่ม:

- blueprint recipes
- delivery target/provider controls
- profile-aware jobs
- model/provider selection
- richer run diagnostics

Mobile ต้องระวังเรื่อง background ask ตาม P0 เพราะ cron run อาจเป็น session ที่ต้องรอผู้ใช้ตอบ

### Kanban

Mobile มี:

- board switcher
- task list/detail
- create/edit/delete
- move task
- priority/progress
- comment count
- warning indicators

Desktop เพิ่ม:

- drag-and-drop
- multi-select และ bulk actions
- comments/composer
- attachments
- per-agent lanes
- run history/worker logs
- diagnostics/recovery
- model/provider/reasoning override
- orchestration settings
- auto-decompose

บน Mobile ควรใช้ touch-first workflow เช่น tap-and-select destination แทนการ port drag-and-drop โดยตรง

## จุดได้เปรียบเฉพาะ Mobile

Mobile ไม่ควรพยายาม copy Desktop ทุกด้าน เพราะมีจุดแข็งเฉพาะ mobile:

- phone-first drawer
- recent chat search และ infinite scroll
- biometric unlock
- SecureStore
- local background notification
- profile picker
- touch-friendly bottom sheets/popovers
- mobile image/document picker
- per-profile recent session/model persistence

ควรสร้าง mobile equivalent แทนการ replicate UI desktop:

| Desktop | Mobile equivalent |
|---|---|
| approval notification actions | background ask inbox + notification actions |
| drag-and-drop Kanban | touch move/bulk action |
| embedded browser | system browser หรือ safe deep link |
| file manager bridge | share/open file |
| desktop side panel | mobile review sheet/screen |
| terminal pane | remote output หรือ external handoff |
| multi-window | foreground session + active/background session switcher |

## Roadmap ที่แนะนำ

### Sprint 0 — Safety / Continuity

1. [x] Background ask inbox
2. [x] Notification approve/reject/answer
3. [x] Per-session owner registry (single gateway connection)
4. [x] Background completion notification
5. [x] Reconnect/open-request hydration
6. [ ] Full multi-profile owner routing และ headless notification action

### Sprint 1 — Core parity

1. เพิ่ม `Skills`, `Toolsets`, `MCP` และ `Plugins` เป็นรายการย่อยภายใต้ `More` ของ Drawer
2. คง route `/skills` และ `/toolsets` เดิม และเพิ่ม route `/mcp` กับ `/plugins`
3. เพิ่ม model/provider/fallback management
4. เพิ่ม connection registry และ remote auth
5. เพิ่ม history pagination / load older
6. เพิ่ม Profiles management
7. เพิ่ม Agents/Messaging/Artifacts ตามลำดับความสำคัญ

### Sprint 2 — Workflow parity

1. Project/worktree context
2. Git review
3. Commit/push/PR mobile workflow
4. Cron blueprint และ profile-aware delivery
5. Kanban comments, attachments, bulk move และ orchestration
6. Mobile Command Center

### Sprint 3 — Power-user features

1. Starmap
2. Session Import
3. Webhooks
4. Voice/browser polish
5. Local model management
6. Mobile global command/action sheet

## Definition of Done สำหรับ parity

ก่อนประกาศว่า Mobile รองรับงานเบื้องหลังเทียบ Desktop ควรมีอย่างน้อย:

- [ ] session event ไม่ปนระหว่าง session
- [ ] background turn แสดงสถานะได้แม้ผู้ใช้เปิด session อื่น
- [ ] approval/clarify ของ background session ตอบได้จาก notification หรือ inbox
- [ ] request เดิมตอบซ้ำไม่ได้
- [ ] reconnect แล้ว pending request ยังอยู่
- [ ] runtime session ID map กลับ stored session ID ได้
- [ ] profile/connection scope ไม่ถูกนำไปใช้ผิด backend
- [ ] mobile actions มี loading/error/success state
- [ ] มี automated test สำหรับ session routing และ reconnect

## สถานะการตรวจสอบ

หลังจากเริ่ม P0 vertical slice:

- [x] TypeScript: `npx tsc --noEmit`
- [x] Node tests สำหรับ ask inbox, gateway routing/replay และ message helpers
- [x] Web bundle: `npx expo export --platform web`
- [ ] ทดสอบ notification action บน Android/iOS development build
- [ ] ทดสอบ background cron/approval กับ gateway จริง
- [ ] ทดสอบ multi-profile/connection isolation
- [ ] ทดสอบ process kill/relaunch และ notification cold start

เอกสาร `docs/TESTING.md` เป็น manual test plan สำหรับ session-state/event fixes และควรใช้ร่วมกับเอกสารนี้เมื่อทดสอบ P0/P1
