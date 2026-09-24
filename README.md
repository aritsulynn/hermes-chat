# Hermes Mobile — Expo (React Native) client for the Hermes dashboard

Native-feel chat app that talks to your Hermes gateway through the **dashboard**
(port 9119): REST session-cookie auth + JSON-RPC 2.0 over `/api/ws`.
No API-server key needed — it uses the same basic_auth login as the web UI.

## Protocol (verified against hermes-agent source + live dashboard 0.21.3)

- `GET /api/status` → `{auth_required, auth_providers}` (probe)
- `POST /auth/password-login {provider:"basic", username, password, next:""}`
  → `Set-Cookie: hermes_session_at` (+ rt/provider)
- `POST /api/auth/ws-ticket {}` (cookie) → `{ticket, ttl_seconds}` —
  single-use, ~30s TTL. Mint fresh before **every** (re)connect, pass as
  `/api/ws?ticket=...` (query param works; the subprotocol form is optional).
- WS frames: client RPC `{jsonrpc,id,method,params}` → reply `{id, result|error}`;
  events `{method:"event", params:{type,...}}`; server asks carry `id:"srq-*"`
  + `method` and MUST be answered with the same id.
- Chat: `session.list` → `session.resume` + history →
  `prompt.submit {session_id, text}` → `message.delta*` → `message.complete`.
  Strict param validation — extra keys 400, so submit takes NO model/effort.
  History prefers REST `GET /api/sessions/{id}/messages?order=latest`
  (full rows: tool results + reasoning sidecars; WS `session.history` is
  only a compact projection and the fallback).
  Stop button = `session.interrupt`. Heartbeat = `gateway.ping` every 15s.
- Server asks: `clarify` (single `{answer}` / batch `{answers}`, lock progress
  via `clarify.lock`), `approval` (`{choice}` from payload's `choices`),
  `sudo`/`secret`/`vault.*` (single masked string under `{value}`).
- Models: WS `model.options {session_id?}` → `{providers:[{slug,name,
  is_current,models[]|null,total_models}]}` (same builder as REST
  `GET /api/model/options`); session-scoped switch ("this chat") =
  `command.dispatch {name:"model", arg:"<model> --provider <slug>",
  session_id}` (no `--global`, config untouched); global default =
  `POST /api/model/set {scope:"main",provider,model}`.
- REST with the cookie: NO `Authorization` header (the dashboard 401s it in
  gated mode — verified live against this project's own backend).

## Run

```bash
cd hermes-mobile
npm install
npx expo start
```

Scan the QR with Expo Go, or `a`/`i` for an emulator. On first launch fill
host (`http://192.168.1.8:9119` on home WiFi, Tailscale IP outside),
username + password → Connect.

## Files

- `app/_layout.tsx` — expo-router `Drawer` root (native header, custom drawer content, bottom-sheet provider, splash gate)
- `app/login.tsx`, `app/sessions.tsx`, `app/chat.tsx` — routes (auth-guarded, redirect to `/login` when logged out)
- `app/asks.tsx` + `src/screens/asks/` — background Ask Inbox under Drawer → More
- `src/store.tsx` — global state: connection, gateway WS, sessions, transcript, model picker, ask sheets
- `src/ui.tsx` — shared UI: Composer, Field, bottom sheets (`@gorhom/bottom-sheet`: Info/Ask/menus), TypingDots, markdown styles
- `src/models.ts` — message/attachment types + pure helpers
- `src/dashboard.ts` — REST auth (probe, password-login, ws-ticket, cookie jar)
- `src/gateway-ws.ts` — WS JSON-RPC client (reconnect + ticket refresh, events)
- `src/connection.ts` — SecureStore vault (host/username/password/cookie)

## Protocol reference

The dashboard protocol used here (REST + `/api/ws`): auth flow is
password-login → session cookie → single-use ws-ticket, and the cookie must
never be paired with an `Authorization` header. Ops screens (cron, kanban,
logs, billing) follow the dashboard's own REST routes.
