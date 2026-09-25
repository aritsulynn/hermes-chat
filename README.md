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

## Connect to Hermes

Hermes Mobile is a dashboard client only. It does not start Hermes, create certificates, configure a reverse proxy, or modify the host's Hermes settings. Complete the server-side setup before connecting the app.

For a trusted LAN connection:

1. Start the Hermes dashboard on a host reachable from the device:

   ```bash
   hermes dashboard --host 0.0.0.0 --port 9119
   ```

2. Configure dashboard basic authentication on the host, for example in `~/.hermes/config.yaml`:

   ```yaml
   dashboard:
     basic_auth:
       username: your-username
       password: your-password
   ```

3. Keep the device and host on a trusted private network, and allow port `9119` only where it is needed. Do not expose this HTTP port directly to the internet.

4. Enter the dashboard URL in the app, for example:

   ```text
   http://192.168.1.8:9119
   ```

   The app accepts both `http://` and `https://` URLs. It does not provision TLS certificates or CA trust; if HTTPS is required, configure the certificate and any reverse proxy on the host first, then enter the `https://` URL.

## Run

```bash
cd hermes-mobile
npm install
npx expo start
```

Scan the QR with Expo Go, or press `a`/`i` for an emulator. On first launch, complete the dashboard setup above, then fill in the host URL, username, and password → Connect.

## Release signing

The Android config plugin removes the generated release fallback to the public debug keystore. A production build must receive a real keystore through EAS/CI environment variables (`HERMES_KEYSTORE_PATH`, `HERMES_KEYSTORE_PASSWORD`, `HERMES_KEY_ALIAS`, `HERMES_KEY_PASSWORD`; the corresponding `MYAPP_UPLOAD_*` names are also accepted). Without those values, a local release build remains unsigned rather than being signed with the debug key. Never commit a keystore or its passwords.

## Files

- `src/app/_layout.tsx` — expo-router `Drawer` root (native header, custom drawer content, bottom-sheet provider, splash gate)
- `src/app/login.tsx`, `src/app/chat.tsx` — routes (auth-guarded, redirect to `/login` when logged out)
- `src/app/asks.tsx` + `src/screens/asks/` — background Ask Inbox under Drawer → More
- `src/hooks/app-store.tsx` — global state: connection, gateway WS, sessions, transcript, model picker, ask sheets
- `src/components/` — shared UI: Composer, Field, bottom sheets (`@gorhom/bottom-sheet`: Info/Ask/menus), TypingDots, markdown styles
- `src/utils/messages.ts` — message/attachment types + pure helpers
- `src/lib/dashboard.ts` — REST auth (probe, password-login, ws-ticket, cookie jar)
- `src/lib/gateway-ws.ts` — WS JSON-RPC client (reconnect + ticket refresh, events)
- `src/lib/connection.ts` — SecureStore vault (host/username/password/cookie)
- `src/lib/hermes-update.ts` + `src/components/update-panel.tsx` — server update (Settings → About)

## Protocol reference

The dashboard protocol used here (REST + `/api/ws`): auth flow is
password-login → session cookie → single-use ws-ticket, and the cookie must
never be paired with an `Authorization` header. Ops screens (cron, kanban,
logs, billing) follow the dashboard's own REST routes.

Server updates (Settings → About) mirror the dashboard's System page:
`GET /api/hermes/update/check` (availability, `force=true` busts the 24h
cache) → `POST /api/hermes/update` (spawns `hermes update` in the background)
→ poll `GET /api/actions/hermes-update/status?lines=400` for the live log
until the process exits → `GET /api/hermes/update/receipt` for the durable
outcome. The update restarts the dashboard/gateway, so the poll tolerates a
run of failures while reconnecting. `POST /api/gateway/restart` restarts the
gateway on its own.
