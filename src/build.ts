// Build marker — shown on Login and Settings so a bug report can say exactly
// which code it came from (kills "stale bundle?" guessing).
//
// The native build bumped a literal string by hand on every shipped change. On
// the web there is a real identifier available: vite.config.ts reads the git
// short SHA at build time and defines `__BUILD_ID__`, so this cannot drift out
// of sync with the commit the bundle was built from. Running against a dev
// server there is no build, so it falls back to a marker that says so.
declare const __BUILD_ID__: string | undefined;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev (vite)';
