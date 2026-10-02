// Build marker — shown on Login and Settings so a bug report can say exactly
// which code it came from (kills "stale bundle?" guessing).
//
// The id is read from the build: vite.config.ts defines `__BUILD_ID__` from the
// git short SHA at build time, so it cannot drift out of sync with the commit
// the bundle was built from. Running against a dev server there is no build, so
// it falls back to a marker that says so.
declare const __BUILD_ID__: string | undefined;

export const BUILD_ID: string = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev (vite)';
