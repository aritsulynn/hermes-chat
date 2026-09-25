// Expo config plugin: prevent the generated Android release build from ever
// falling back to the public debug keystore. EAS/CI supplies the production
// keystore through the HERMES_* or MYAPP_UPLOAD_* environment variables.
const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER =
  "// Hermes release signing: never use the public debug keystore.";

const RELEASE_SIGNING = `        release {
            def hermesStorePath = System.getenv('HERMES_KEYSTORE_PATH') ?: System.getenv('MYAPP_UPLOAD_STORE_FILE') ?: findProperty('HERMES_KEYSTORE_PATH')
            def hermesStorePassword = System.getenv('HERMES_KEYSTORE_PASSWORD') ?: System.getenv('MYAPP_UPLOAD_STORE_PASSWORD') ?: findProperty('HERMES_KEYSTORE_PASSWORD')
            def hermesKeyAlias = System.getenv('HERMES_KEY_ALIAS') ?: System.getenv('MYAPP_UPLOAD_KEY_ALIAS') ?: findProperty('HERMES_KEY_ALIAS')
            def hermesKeyPassword = System.getenv('HERMES_KEY_PASSWORD') ?: System.getenv('MYAPP_UPLOAD_KEY_PASSWORD') ?: findProperty('HERMES_KEY_PASSWORD')
            if (hermesStorePath) {
                if (!hermesStorePassword || !hermesKeyAlias || !hermesKeyPassword) {
                    throw new GradleException('A production keystore path requires its password, key alias, and key password')
                }
                storeFile file(hermesStorePath)
                storePassword hermesStorePassword
                keyAlias hermesKeyAlias
                keyPassword hermesKeyPassword
            }
        }
`;

/** Exported for a small regression test and for easier prebuild verification. */
function patchReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;

  const signingStart = contents.indexOf("    signingConfigs {");
  const buildTypesStart = contents.indexOf("    buildTypes {", signingStart);
  if (signingStart < 0 || buildTypesStart < 0) {
    throw new Error(
      "secure-release-signing: unsupported Android app/build.gradle template",
    );
  }

  const signingBlock = contents.slice(signingStart, buildTypesStart);
  const signingClose = signingBlock.lastIndexOf("    }");
  if (signingClose < 0) {
    throw new Error(
      "secure-release-signing: could not locate signingConfigs closure",
    );
  }

  const patchedSigningBlock = [
    signingBlock.slice(0, signingClose),
    RELEASE_SIGNING,
    signingBlock.slice(signingClose),
  ].join("");
  const withRelease =
    contents.slice(0, signingStart) +
    patchedSigningBlock +
    contents.slice(buildTypesStart);

  const buildTypesInPatched = withRelease.indexOf("    buildTypes {");
  const releaseBlockStart = withRelease.indexOf(
    "        release {",
    buildTypesInPatched,
  );
  if (releaseBlockStart < 0) {
    throw new Error(
      "secure-release-signing: could not locate release build type",
    );
  }

  const beforeRelease = withRelease.slice(0, releaseBlockStart);
  const releaseBlock = withRelease.slice(releaseBlockStart);
  const debugLine = "            signingConfig signingConfigs.debug";
  const debugLineStart = releaseBlock.indexOf(debugLine);
  if (debugLineStart < 0) {
    throw new Error(
      "secure-release-signing: release build type has no debug signing line to replace",
    );
  }

  const safeReleaseLine = [
    "            if (signingConfigs.release.storeFile != null) {",
    "                signingConfig signingConfigs.release",
    "            }",
  ].join("\n");
  const patchedRelease =
    releaseBlock.slice(0, debugLineStart) +
    safeReleaseLine +
    releaseBlock.slice(debugLineStart + debugLine.length);
  return `${MARKER}\n${beforeRelease}${patchedRelease}`;
}

module.exports = function withSecureReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (
      cfg.modResults?.language === "groovy" &&
      typeof cfg.modResults.contents === "string"
    ) {
      cfg.modResults.contents = patchReleaseSigning(cfg.modResults.contents);
    }
    return cfg;
  });
};

module.exports.patchReleaseSigning = patchReleaseSigning;
