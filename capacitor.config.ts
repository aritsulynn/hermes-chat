import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.kirara.hermes',
  appName: 'Hermes',
  // Vite emits to `dist/` — this is what `npx cap sync` copies into the
  // native projects. No `server.url` here: production loads the bundled copy.
  // Native projects (`android/`, `ios/`) are intentionally not in git yet;
  // add them with `npx cap add android ios` when we start building on device.
  webDir: 'dist',
  server: {
    // The WebView default is `https://localhost`, which makes every
    // plain-HTTP gateway call (http://192.168.x.x:9119) mixed content that the
    // WebView silently blocks — while Chrome, doing top-level navigation to
    // the same URL, loads it fine. Serving the bundle over `http` keeps the
    // page and the gateway on the same scheme. `http://localhost` is still a
    // secure context, so clipboard and friends keep working.
    androidScheme: 'http',
    // The Capacitor-native twin of the `usesCleartextTraffic` flag already in
    // android/app/src/main/AndroidManifest.xml: lets the WebView talk to
    // plain-HTTP hosts on the LAN. Re-applied on every `cap sync`.
    cleartext: true,
  },
};

export default config;
