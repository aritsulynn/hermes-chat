import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';
import path from 'node:path';

/**
 * The build id shown on Login and Settings, so a bug report can name the exact
 * commit its bundle came from. Reads git at config time rather than being a
 * hand-bumped literal, which is what it was on native and which is exactly the
 * kind of thing that drifts. Falls back when git is unavailable (a tarball
 * build, a shallow CI checkout with no refs).
 */
function buildId(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return sha ? `${sha}${dirty ? '-dirty' : ''}` : 'unknown';
  } catch {
    return 'unknown';
  }
}

// Plain Vite + React. The Expo/metro half of this file is gone; what survives
// is the `@/` alias, which is still worth having because `src/components/ui/*`
// was authored against it (see components.json) and the reusables registry
// expects it to keep resolving.
export default defineConfig({
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    // The gateway is user-supplied and is almost always a plain-HTTP host on a
    // LAN address (e.g. http://192.168.1.10:9119), so dev-server cross-origin
    // preflights have to be tolerated. CORS itself is the gateway's problem.
    host: true,
    port: 5173,
  },
  build: {
    // The gateway WS + streaming path is the one thing here that can be
    // genuinely large; a single warning threshold is enough to notice growth.
    chunkSizeWarningLimit: 900,
  },
});
