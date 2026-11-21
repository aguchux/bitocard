// Marks hardware the manifest declares as wanted but not required, so Google Play offers the app to every device:
// portrait screens (from "orientation": "portrait"), Wi-Fi (from a library) and the camera and its autofocus (implied
// by the camera permission: photos can still come from the library, so devices without a camera can sell too). tools:replace wins over any library
// that declares one as required.
const { withAndroidManifest } = require('expo/config-plugins');

const optional = ['android.hardware.screen.portrait', 'android.hardware.wifi', 'android.hardware.camera', 'android.hardware.camera.autofocus'];

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
