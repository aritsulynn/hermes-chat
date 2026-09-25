import assert from "node:assert/strict";
import test from "node:test";

import signingPlugin from "../../plugins/secure-release-signing.js";

const { patchReleaseSigning } = signingPlugin;
const template = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}`;

test("release signing plugin removes the debug fallback and is idempotent", () => {
  const patched = patchReleaseSigning(template);
  assert.match(patched, /HERMES_KEYSTORE_PATH/);
  assert.match(patched, /if \(signingConfigs\.release\.storeFile != null\)/);
  assert.doesNotMatch(
    patched.slice(
      patched.indexOf("        release {", patched.indexOf("    buildTypes {")),
    ),
    /signingConfig signingConfigs\.debug/,
  );
  assert.equal(patchReleaseSigning(patched), patched);
});
