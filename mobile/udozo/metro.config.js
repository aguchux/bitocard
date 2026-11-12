// Metro, as Expo sets it up. The shared Udozo types live in src/shared (copied by scripts/sync-shared.mjs), read as
// `@shared/...` through tsconfig's paths.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
