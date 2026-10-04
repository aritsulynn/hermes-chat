# Security Policy

## What this project holds

This client stores almost nothing sensitive, on purpose:

- **No password, ever.** The login screen sends it once and it is never
  persisted — not to `localStorage`, not to disk. Reloading asks again.
- **The dashboard session lives in the browser's own cookie jar**, where JavaScript
  cannot read it. The app keeps only the string `web-jar` as a marker so a reload
  knows a session may exist.
- **Host, username, theme and UI preferences are stored**, scoped to
  host + username. They are not credentials.

So a stolen browser profile is the realistic risk, not a leaked secret in this
repo's storage.

## Reporting a vulnerability

Open a **private** report — GitHub's _Security → Report a vulnerability_ tab on
the repository — rather than a public issue. Please include:

- what an attacker can do, and what they need in order to do it
- the version or commit (`git rev-parse --short HEAD`; the build id is shown on
  the Login and Settings screens)
- whether the gateway's own behaviour is involved

You can expect an acknowledgement within a few days. Fixes land as a normal
commit; there is no disclosure deadline imposed from this side, so tell us if
publishing sooner would help you.

## Threat model in one paragraph

This client is a browser tab talking to a gateway you already trust with your
agent. Anyone who can serve code to that origin — or who can read your browser
profile — can already act as you against that gateway; CORS is a browser
enforcement mechanism, not an authentication boundary, and the gateway's
allowlist (`dashboard.cors_origins`) is the real control. Treat a
cross-origin-served build as equivalent to running the gateway's own dashboard,
and prefer serving this client from the gateway's own origin. The
[cross-origin section of the README](README.md#serving-from-another-origin-what-the-gateway-must-allow)
and [docs/troubleshooting.md](docs/troubleshooting.md) cover the mechanics.

## Out of scope

- Vulnerabilities in the Hermes gateway itself. That is a different project with
  its own process; report them there.
- The Android shell's WebView defaults, and anything about how the OS sandboxing
  behaves.
- Missing hardening in a gateway that predates the feature you are asking about.
