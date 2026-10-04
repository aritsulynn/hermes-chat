# Troubleshooting

> Failures we have actually hit, how to tell them apart, and what fixes them.
> Each entry gives the symptom first, then one command that decides it.
> Last updated: 2026-10-04

---

## Login fails with `Ticket request failed: Failed to fetch`

> [!IMPORTANT]
> The gateway is almost certainly **up and answering**. The browser is refusing to
> show you its answer, because a CORS preflight came back without CORS headers.
> Do not go looking for a network problem.

**Symptom.** On the login screen: `Ticket request failed: Failed to fetch`. The
probe and the password step both succeed — `/api/status` returns 200 and the
credentials are accepted — and then it dies on the third request. Every
mutating screen fails the same way afterwards if you get past login by hand.

**Only happens when the app and the gateway are on different origins.** A
`localhost:5173` app against a `192.168.1.42:9119` gateway is cross-origin, so it
hits this. Same-origin (the app served from the gateway's own origin) never
does: a same-origin request is never preflighted. The Android build never does —
it talks to the gateway through `NativeHttpPlugin`, which is a plain
`HttpURLConnection` with no browser network stack, so no CORS and no preflight
exist to fail.

### Decide it with one command

```bash
curl -s -o /dev/null -D - -X OPTIONS \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  http://<gateway-host>:9119/api/auth/ws-ticket
```

| Answer                                                           | Meaning                                                                |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `200` **with** `access-control-allow-origin`                     | Fixed. If login still fails, the problem is elsewhere.                 |
| `401`/`403` with **no** `access-control-*` header at all         | The bug below. The auth gate is answering the preflight.               |
| `400` with allow-methods/credentials/headers but no allow-origin | Your origin is not in the allowlist — see **Configure the allowlist**. |
| Connection refused / timeout                                     | The gateway really is unreachable. Not this.                           |

### Cause

In the gateway (`hermes_cli/web_server.py`), `CORSMiddleware` was registered
next to the app definition — _before_ the `@app.middleware("http")` handlers.
Starlette's `add_middleware` inserts at index 0 of `user_middleware` and the
stack is wrapped in reverse, so **the last registration ends up outermost**.
Registering CORS early therefore put it at the _innermost_ layer, inside
`_dashboard_auth_gate`.

That gate short-circuits any unauthenticated request with its own
`JSONResponse(401)`, which never travels back out through CORSMiddleware. Two
consequences, both fatal cross-origin:

1. **`OPTIONS /api/*` was answered by the gate with a headerless 401.** The
   browser rejects the preflight, never sends the real request, and `fetch`
   rejects with a bare `TypeError: Failed to fetch` — which reads like a dead
   host. `ws-ticket` is simply the first request in the connect pipeline that is
   both under `/api/` and preflighted, which is why login is where it surfaces.
2. **Genuine 401s carried no `Access-Control-Allow-Origin`**, so the client
   could never read _why_ it was refused.

### Fix it on your own gateway

There is no config or env switch for this: the middleware order is decided where
the middleware is registered, so it has to be edited. It is one block, and the
rest of the stack is untouched.

**1. Find your install.** Usually `~/.hermes/hermes-agent`, but not always — the
`hermes` on your PATH decides:

```bash
python3 -c "import hermes_cli, os; print(os.path.dirname(hermes_cli.__file__))"
```

**2. Confirm the block you are about to move.** It sits next to the app
definition, roughly 100 lines above the first `@app.middleware("http")`:

```bash
cd <install-dir>
grep -n "^app.add_middleware" hermes_cli/web_server.py   # the call
grep -n "^# CORS" hermes_cli/web_server.py               # the comment above it
grep -n "^app = FastAPI" hermes_cli/web_server.py       # for comparison
```

You are looking for an `app.add_middleware(` call whose first argument is
`CORSMiddleware`, together with the `# CORS` comment above it. Match on
`^app.add_middleware` rather than on `add_middleware(CORSMiddleware` — the call
spans several lines, so the two are never on one line. Note the line number: on an
unpatched install the call lands around `460`, far above the auth middlewares,
which is the whole problem. A patched install has it near the end of the file
instead.

**3. Move it to the end of the file.** Cut the comment _and_ the
`app.add_middleware(...)` call together — the comment explains why the position
matters, so it has to travel with the code — and paste them after the **last**
`@app.middleware("http")` in the file, which is `_dashboard_health_middleware`:

```bash
grep -n "^@app.middleware" hermes_cli/web_server.py | tail -3
```

Past that function's `return response`, at module level, not inside it. Last
registration means outermost layer: `add_middleware` inserts at index 0 of
`user_middleware` and the stack is wrapped in reverse.

**4. While you are there, stop hardcoding a LAN IP.** If the regex has your
machine's address baked into it, whoever pulls your change gets _your_ IP and
still cannot log in. Replace the call with one that reads the install's own
config, and move it to the end of the file in the same edit:

```python
def _cors_allowed_origins() -> list[str]:
    """Loopback hosts plus whatever this install listed in
    ``dashboard.cors_origins`` / ``HERMES_DASHBOARD_CORS_ORIGINS``.

    A listed entry is a host (``192.168.1.42``), a ``host:port`` pair, or a full
    origin (``http://hermes.example``). The port stays optional either way, so
    one entry covers every dev port on that host. Only host characters are
    accepted — an entry that cannot be a hostname is dropped rather than
    interpolated, because this string is compiled into a regex and a stray
    ``.*`` in a config file would silently turn the closed list into an open one.
    """
    out = ["localhost", "127\\.0\\.0\\.1"]
    try:
        cfg = load_config().get("dashboard") or {}
    except Exception:
        cfg = {}
    raw = cfg.get("cors_origins") or os.environ.get("HERMES_DASHBOARD_CORS_ORIGINS", "")
    if isinstance(raw, str):
        entries: list = [p for p in re.split(r"[,\s]+", raw) if p]
    elif isinstance(raw, (list, tuple)):
        entries = list(raw)
    else:
        entries = []
    for entry in entries:
        host = str(entry).strip()
        if not host:
            continue
        if "://" in host:
            host = host.split("://", 1)[1]
        host = host.split("/", 1)[0].split(":", 1)[0]  # drop port, path
        if host and re.fullmatch(r"[A-Za-z0-9._-]+", host):
            out.append(re.escape(host))
    return out


app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(?:%s)(:\d+)?$" % "|".join(_cors_allowed_origins()),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

`load_config` and `re` are already imported at the top of that module, and
`os` is too. Add the matching key to your config defaults if you want it
discoverable (`config_defaults.py`, under `"dashboard"`):

```python
"cors_origins": [],  # env HERMES_DASHBOARD_CORS_ORIGINS wins when non-empty
```

Nothing else moves: the relative order of the auth middlewares is untouched, so
the host check still runs first, the plugin gate still runs after auth (so an
unauthenticated caller still gets 401 and not a plugin-name oracle), and the
token seam still runs before both. Being outermost also means CORSMiddleware
answers the preflight itself and never calls the gate for it — a preflight
carries no credentials by design, so gating one was never meaningful.

**5. Name your origin.** Under **Configure the allowlist** below. Without this,
any origin other than `localhost`/`127.0.0.1` gets `400 Disallowed CORS origin`
and the browser blocks it — a different-looking failure for the same page.

**6. Restart the dashboard, for real.** This is the part that catches people:

```bash
hermes dashboard --stop
hermes dashboard --host 0.0.0.0 --port 9119 --no-open
```

Re-running `hermes dashboard` on its own does **not** restart anything — it finds
the running instance, prints `already running on this host: PID …`, and exits.
And `hermes gateway run` / `systemctl restart hermes-gateway` is a _different
process_: it is the Telegram/webhook gateway and serves nothing on the dashboard
port. Check which process owns the port before believing you restarted:

```bash
ss -ltnp | grep 9119     # the pid here is the one that must change
```

**7. Verify** with the commands under **Verify** below. Both should be `200`, and
a foreign origin should still be `400`.

### What your edit costs you

A local patch has a consequence worth knowing before you make one:
`hermes update` **skips code updates on a checkout with uncommitted changes**
(`update_cmd_git.py` calls a dirty tree `"the genuinely unsafe case"`). Commit
it on a branch and the update parks on that branch instead, warning that the
checkout is behind `origin`. Either way you are now carrying this yourself —
which is the argument for sending it upstream rather than patching each install.

### Cannot patch the gateway?

Then serve the client from the gateway's own origin and none of this applies: a
same-origin request is never preflighted. The gateway serves whichever `dist/`
`HERMES_WEB_DIST` points at, so pointing it at this project's build is enough:

```bash
npm run build
HERMES_WEB_DIST="$PWD/dist" hermes gateway run
```

Two caveats: while that variable is set, the gateway serves this app **instead
of** its own dashboard UI, and it injects its theme CSS and `window.__HERMES_*`
globals into `index.html` (harmless globals, but the CSS can collide with this
app's own theme variables — check dark mode).

### Configure the allowlist

`localhost` and `127.0.0.1` are always allowed. Any other origin has to be
named by the install that serves it — a LAN address is per-machine, so it does
not belong in the source:

```yaml
# ~/.hermes/config.yaml
dashboard:
  cors_origins:
    - 192.168.1.42 # this machine's dev server
```

```bash
# or, no config edit:
export HERMES_DASHBOARD_CORS_ORIGINS="192.168.1.42, http://hermes.example"
```

The port stays optional, so one entry covers every dev port on that host. Entries
may be `host`, `host:port`, or a full origin. Anything that is not a hostname
is **dropped**, not interpolated: the list is compiled into a regex, and a stray
`.*` in a config file would silently turn a closed allowlist into an open one.

> [!WARNING]
> This list decides who can drive an authenticated browser session as this user.
> Name the specific host that serves your client. Never a wildcard, never a whole
> subnet — every device on that network would qualify.

### Verify

```bash
# 1. preflight passes, from each origin you actually use
for o in http://localhost:5173 http://192.168.1.42:5173; do
  echo -n "$o -> "
  curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS \
    -H "Origin: $o" -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: content-type" \
    http://localhost:9119/api/auth/ws-ticket
done

# 2. an origin outside the list is still refused
curl -s -o /dev/null -w "%{http_code}\n" -X OPTIONS \
  -H "Origin: http://evil.example" -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" \
  http://localhost:9119/api/auth/ws-ticket      # expect 400
```

In the browser, a good pass is that `POST /api/auth/ws-ticket` now returns a
readable status instead of throwing. An unauthenticated `401` with
`access-control-allow-origin` attached is the correct answer at that point —
with a session cookie it becomes `200` and a ticket.

### Not this problem

| Message                           | Actual cause                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `Unreachable: Failed to fetch`    | The host is unreachable — wrong address, wrong WiFi, gateway down. No preflight involved.   |
| `Login request failed: …`         | Same, one step later. `/auth/password-login` is outside the gate and does get CORS headers. |
| `WS ticket mint failed: HTTP 401` | CORS is fine; the session is genuinely absent or expired.                                   |
| Browser is fine, Android is fine  | Expected. See the origin note above.                                                        |

---

## The password disappears while editing the Host field

**Symptom.** Clear or retype the Host field on the login screen and the Password
field empties itself.

**Cause.** An effect in `src/store/useAppStore.tsx` compared the current
host+username scope against the scope the password was typed under and wiped the
password on any mismatch. That guard cannot tell "the user is switching
dashboards" from "the user is fixing a typo" — emptying the Host field makes the
scope `''`, which never matches, so the password died on the first character
deleted.

**Fix.** There is no effect any more. The guarantee it was defending is enforced
at the one place the password leaves the app: `login()` in
`src/store/slices/useConnection.ts` reads it only when
`passwordScopeRef.current` equals the current scope, so a password typed for
another dashboard is never sent there — it falls back to that scope's stored
credential (there is none; no password is ever stored) and reports
`Fill host, username and password`.

---

## Cross-links

- [Deployment → serving from another origin](../README.md#serving-from-another-origin-what-the-gateway-must-allow)
  — what the gateway must allow, and the four setups that work
- [Backlog](backlog.md) — pending work, in case you would rather fix it than
  patch around it
