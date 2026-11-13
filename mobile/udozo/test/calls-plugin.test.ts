// The calls config plugin's iPhone parts: PushKit in Expo's Swift AppDelegate, and UdozoCallPush beside it, each idempotent.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const plugin = require('../plugins/with-udozo-calls.js') as { appDelegateWithCalls: (contents: string) => string; writeCallPush: (folder: string) => void };

// Expo SDK 58's AppDelegate (expo-template-bare-minimum), trimmed to what the plugin touches.
const appDelegate = `internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    reactNativeFactory = factory
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

test('PushKit is registered at launch and the AppDelegate becomes its delegate, once', () => {
  const once = plugin.appDelegateWithCalls(appDelegate);
  assert.match(once, /import PushKit\nimport React/);
  assert.match(once, /UdozoCallPush\.registerForCalls\(\)\n\s*return super\.application/);
  assert.match(once, /extension AppDelegate: PKPushRegistryDelegate \{/);
  assert.match(once, /didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping \(\) -> Void/);
  assert.match(once, /UdozoCallPush\.receive\(payload, type: type\.rawValue, completion: completion\)/);
  assert.equal(plugin.appDelegateWithCalls(once), once);
});

test('an AppDelegate it cannot place the registration in fails the build instead of shipping without calls', () => {
  assert.throws(() => plugin.appDelegateWithCalls('import React\nclass AppDelegate {}\n'), /didFinishLaunching/);
});

test('UdozoCallPush is written beside the AppDelegate and imported in the bridging header once', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'udozo-calls-'));
  fs.writeFileSync(path.join(folder, 'Udozo-Bridging-Header.h'), '//\n// Use this file to import your target\'s public headers.\n//\n');
  plugin.writeCallPush(folder);
  plugin.writeCallPush(folder);
  const bridging = fs.readFileSync(path.join(folder, 'Udozo-Bridging-Header.h'), 'utf8');
  assert.equal(bridging.match(/#import "UdozoCallPush\.h"/g)?.length, 1);
  const source = fs.readFileSync(path.join(folder, 'UdozoCallPush.m'), 'utf8');
  // The push's fields as the API sends them (native-push.ts), the call's id as CallKit's UUID.
  assert.match(source, /data\[@"call_id"\]/);
  assert.match(source, /data\[@"caller"\]/);
  assert.match(source, /data\[@"about"\]/);
  assert.match(source, /reportNewIncomingCall:reported/);
  assert.match(source, /fromPushKit:YES/);
  assert.match(fs.readFileSync(path.join(folder, 'UdozoCallPush.h'), 'utf8'), /NS_SWIFT_NAME\(receive\(_:type:completion:\)\)/);
  fs.rmSync(folder, { recursive: true, force: true });
});

test('release shrinking keeps WebRTC and does not stop on its optional decoders', () => {
  const rules = (require('../plugins/with-udozo-calls.js') as { webrtcRules: string }).webrtcRules;
  assert.match(rules, /-keep class org\.webrtc\.\*\* \{ \*; \}/);
  assert.match(rules, /-dontwarn org\.webrtc\.\*\*/);
});
