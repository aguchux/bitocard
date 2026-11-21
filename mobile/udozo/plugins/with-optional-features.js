// Marks hardware the manifest declares as wanted but not required, so Google Play offers the app to every device:
// portrait screens (from "orientation": "portrait") and Wi-Fi (from a library). tools:replace wins over any library
// that declares one as required.
const { withAndroidManifest } = require('expo/config-plugins');

const optional = ['android.hardware.screen.portrait', 'android.hardware.wifi'];

module.exports = function withOptionalFeatures(config) {
  return withAndroidManifest(config, mod => {
    const manifest = mod.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] ?? 'http://schemas.android.com/tools';
    const features = (manifest['uses-feature'] ?? []).filter(feature => !optional.includes(feature.$['android:name']));
    for (const name of optional) features.push({ $: { 'android:name': name, 'android:required': 'false', 'tools:replace': 'android:required' } });
    manifest['uses-feature'] = features;
    return mod;
  });
};
