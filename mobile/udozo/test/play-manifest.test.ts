// What Google Play sees in the Android manifest: no photo, video, audio-file or storage permissions (the system photo
// picker needs none, and screenshots are only blocked, never detected), no phone or overlay permissions (calls are a
// self-managed ConnectionService), and portrait screens and Wi-Fi wanted but never required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const app = JSON.parse(fs.readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;
const optional = require('../plugins/with-optional-features.js') as (config: object) => object;

test('media and storage permissions are blocked, the microphone and camera kept for calls and photos', () => {
  const blocked: string[] = app.android.blockedPermissions;
  for (const name of ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_VISUAL_USER_SELECTED', 'READ_MEDIA_AUDIO', 'READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE']) {
    assert.ok(blocked.includes(`android.permission.${name}`), name);
  }
  assert.ok(!blocked.some(name => /RECORD_AUDIO|CAMERA/.test(name)));
  // The advertising ID (which Facebook's SDK would add): nothing in the app advertises or tracks.
  assert.ok(blocked.includes('com.google.android.gms.permission.AD_ID'));
});

test('the optional-features plugin is applied and marks portrait and Wi-Fi as not required', () => {
  assert.ok(app.plugins.includes('./plugins/with-optional-features'));
  let edit: ((mod: { modResults: { manifest: Record<string, unknown> } }) => unknown) | undefined;
  // withAndroidManifest from expo/config-plugins queues a mod; read it back from the config it returns.
  const config = optional({ name: 'x', slug: 'x', mods: {} }) as { mods: { android: { manifest: typeof edit } } };
  edit = config.mods.android.manifest;
  const manifest: Record<string, unknown> = { $: {}, 'uses-feature': [{ $: { 'android:name': 'android.hardware.wifi', 'android:required': 'true' } }] };
  // The queued mod calls the next one; give it a pass-through.
  const result = (edit as unknown as (mod: object) => Promise<{ modResults: { manifest: { 'uses-feature': { $: Record<string, string> }[] } } }>)({
    modResults: { manifest },
    modRequest: { platform: 'android', nextMod: (mod: object) => mod },
  });
  return Promise.resolve(result).then(({ modResults }) => {
    const features = modResults.manifest['uses-feature'].map(feature => feature.$);
    for (const name of ['android.hardware.screen.portrait', 'android.hardware.wifi', 'android.hardware.camera', 'android.hardware.camera.autofocus']) {
      const feature = features.filter(f => f['android:name'] === name);
      assert.equal(feature.length, 1, name);
      assert.equal(feature[0]['android:required'], 'false');
    }
  });
});

test('phone and overlay permissions stay out (the calls plugin blocks them)', () => {
  const calls = fs.readFileSync(new URL('../plugins/with-udozo-calls.js', import.meta.url), 'utf8');
  for (const name of ['CALL_PHONE', 'READ_PHONE_NUMBERS', 'READ_PHONE_STATE', 'SYSTEM_ALERT_WINDOW']) assert.match(calls, new RegExp(`'android\.permission\.${name}'`));
});

test('photos and videos are still chosen and recorded: the system picker, never a media permission', () => {
  const sources: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(next);
      else if (/\.tsx?$/.test(entry.name)) sources.push(fs.readFileSync(next, 'utf8'));
    }
  };
  walk(new URL('../src/', import.meta.url));
  const code = sources.join('\n');
  // The library is Android's photo picker (PickVisualMedia), which needs no permission; asking for media access would
  // be refused now that READ_MEDIA_* are blocked, so nothing may ask for it or opt into the legacy picker.
  assert.doesNotMatch(code, /MediaLibraryPermissions|expo-media-library|legacy\s*:\s*true/);
  for (const kind of ['images', 'videos']) assert.ok(code.includes(`launchImageLibraryAsync({ mediaTypes: ['${kind}']`), kind);
  // Recording photos and videos asks only for the camera, which stays allowed.
  assert.match(code, /requestCameraPermissionsAsync[\s\S]*launchCameraAsync\(\{ mediaTypes: \['videos'\]/);
});

test("react-native-webrtc's screen-sharing service is removed: calls are audio only, so no mediaProjection service", () => {
  const calls = require('../plugins/with-udozo-calls.js') as (config: object) => { mods: { android: { manifest: (mod: object) => unknown } } };
  const config = calls({ name: 'x', slug: 'x', mods: {} });
  const manifest = {
    $: {},
    application: [{ $: { 'android:name': '.MainApplication' }, service: [{ $: { 'android:name': 'com.oney.WebRTCModule.MediaProjectionService', 'android:foregroundServiceType': 'mediaProjection' } }] }],
  };
  return Promise.resolve(config.mods.android.manifest({ modResults: { manifest }, modRequest: { platform: 'android', nextMod: (mod: object) => mod } })).then(result => {
    const merged = (result as { modResults: { manifest: typeof manifest } }).modResults.manifest;
    assert.equal(merged.$['xmlns:tools' as never], 'http://schemas.android.com/tools');
    const services = merged.application[0].service.filter(service => service.$['android:name'] === 'com.oney.WebRTCModule.MediaProjectionService');
    assert.deepEqual(services.map(service => service.$), [{ 'android:name': 'com.oney.WebRTCModule.MediaProjectionService', 'tools:node': 'remove' }]);
  });
});
