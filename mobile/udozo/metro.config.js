// Metro, as Expo sets it up, plus the shared Udozo types and helpers udozo.com uses
// (packages/api-client/src/classifieds.ts and home.ts: no imports of their own), read in place as `@shared/...`.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const shared = path.resolve(__dirname, '../../packages/api-client/src');
config.watchFolders = [...(config.watchFolders ?? []), shared];
config.resolver.extraNodeModules = { ...(config.resolver.extraNodeModules ?? {}), '@shared': shared };

module.exports = config;
