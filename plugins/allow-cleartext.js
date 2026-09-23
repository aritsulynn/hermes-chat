// Expo config plugin: allow plain-HTTP (cleartext) to LAN dashboards.
// `android.usesCleartextTraffic: true` in app.json only sets the manifest
// flag — on some devices/OkHttp versions that alone still blocks
// http://192.168.x.x. An explicit networkSecurityConfig is the reliable path.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const NETWORK_SECURITY_XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- Hermes is LAN/VPN-only plain HTTP by design: allow cleartext everywhere,
         keep system CAs for any https:// hosts. -->
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;

function withCleartextNetworkConfig(config) {
  // 1. Write res/xml/network_security_config.xml into the prebuilt project.
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app/src/main/res/xml',
      );
      await fs.promises.mkdir(dir, { recursive: true });
      await fs.promises.writeFile(
        path.join(dir, 'network_security_config.xml'),
        NETWORK_SECURITY_XML,
      );
      return cfg;
    },
  ]);

  // 2. Point the <application> at it + keep the manifest flag on.
  config = withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults?.manifest?.application?.[0];
    if (app && app.$) {
      app.$['android:usesCleartextTraffic'] = 'true';
      app.$['android:networkSecurityConfig'] = '@xml/network_security_config';
    }
    return cfg;
  });

  return config;
}

module.exports = withCleartextNetworkConfig;
