import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Plain Vite + React. The Expo/metro half of this file is gone; what survives
// is the `@/` alias, which is still worth having because `src/components/ui/*`
// was authored against it (see components.json) and the reusables registry
// expects it to keep resolving.
export default defineConfig({
  plugins: [react()],
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
