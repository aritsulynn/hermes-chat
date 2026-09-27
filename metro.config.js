const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

// inlineRem: 16 makes 1rem resolve to 16px, matching the web, so the
// rem-based sizing in the reusables components lines up across platforms.
module.exports = withNativeWind(config, { input: './global.css', inlineRem: 16 });
