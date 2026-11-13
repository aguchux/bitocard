/**
 * Calls with the app closed: what react-native-callkeep's and react-native-webrtc's own config plugins leave to the app.
 *
 * iPhones:
 * - the `voip` and `audio` background modes (a call carries on with the screen locked);
 * - PushKit in the AppDelegate: Apple requires every VoIP push to be reported to CallKit before the push's handler
 *   returns, even when React Native is not running yet, so `UdozoCallPush` (Objective-C, written beside the
 *   AppDelegate) registers for VoIP pushes at launch, hands the token to react-native-voip-push-notification, and
 *   reports each call to CallKit with the API's `call_id` as the call's UUID and the caller's public name
 *   (`native-push.ts`: `kind`, `call_id`, `caller`, `about`).
 *
 * Android (CallKeep's self-managed mode, so no phone account to enable and no phone permissions to ask):
 * - `MANAGE_OWN_CALLS`, `RECORD_AUDIO` and the foreground service permissions Android 14 needs for a call's
 *   foreground service (`phoneCall` while it rings, `microphone` once answered);
 * - CallKeep's ConnectionService labelled Udozo, with both service types, and its messaging service not exported;
 * - the managed-mode permissions CallKeep's plugin adds (calling and reading phone numbers) and react-native-webrtc's
 *   drawing over other apps removed: the app never uses them.
 */
const { AndroidConfig, IOSConfig, withAndroidManifest, withAppDelegate, withDangerousMod, withInfoPlist, withXcodeProject } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const header = `// Written by plugins/with-udozo-calls.js: PushKit for Udozo's calls.
#import <Foundation/Foundation.h>
#import <PushKit/PushKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface UdozoCallPush : NSObject
+ (void)registerForCalls NS_SWIFT_NAME(registerForCalls());
+ (void)updateCredentials:(PKPushCredentials *)credentials type:(NSString *)type NS_SWIFT_NAME(update(_:type:));
+ (void)receive:(PKPushPayload *)payload type:(NSString *)type completion:(void (^)(void))completion NS_SWIFT_NAME(receive(_:type:completion:));
@end

NS_ASSUME_NONNULL_END
`;

const source = `// Written by plugins/with-udozo-calls.js: PushKit for Udozo's calls.
#import "UdozoCallPush.h"
#import <CallKit/CallKit.h>
#import "RNCallKeep.h"
#import "RNVoipPushNotificationManager.h"

@implementation UdozoCallPush

+ (void)registerForCalls
{
  // CallKit's options before any call is reported (JavaScript's setup() comes later, when React Native runs).
  [RNCallKeep setup:@{ @"appName": @"Udozo", @"supportsVideo": @NO, @"includesCallsInRecents": @NO, @"maximumCallGroups": @"1", @"maximumCallsPerCallGroup": @"1" }];
  [RNVoipPushNotificationManager voipRegistration];
}

+ (void)updateCredentials:(PKPushCredentials *)credentials type:(NSString *)type
{
  [RNVoipPushNotificationManager didUpdatePushCredentials:credentials forType:type];
}

+ (void)receive:(PKPushPayload *)payload type:(NSString *)type completion:(void (^)(void))completion
{
  NSDictionary *data = payload.dictionaryPayload;
  id given = data[@"call_id"];
  NSString *callId = [given isKindOfClass:NSString.class] && [[NSUUID alloc] initWithUUIDString:given] ? [given lowercaseString] : nil;
  NSString *caller = [data[@"caller"] isKindOfClass:NSString.class] ? data[@"caller"] : @"Someone on Udozo";
  NSString *about = [data[@"about"] isKindOfClass:NSString.class] ? data[@"about"] : nil;
  NSString *name = about.length ? [NSString stringWithFormat:@"%@ · %@", caller, about] : caller;
  // Apple ends an app that does not report a VoIP push as a call: a push without a call id is reported, then ended.
  NSString *reported = callId ?: [NSUUID UUID].UUIDString.lowercaseString;
  [RNVoipPushNotificationManager didReceiveIncomingPushWithPayload:payload forType:type];
  [RNCallKeep reportNewIncomingCall:reported
                             handle:@"Udozo"
                         handleType:@"generic"
                           hasVideo:NO
                localizedCallerName:name
                    supportsHolding:NO
                       supportsDTMF:NO
                   supportsGrouping:NO
                 supportsUngrouping:NO
                        fromPushKit:YES
                            payload:data
              withCompletionHandler:completion];
  if (!callId) {
    [RNCallKeep endCallWithUUID:reported reason:1];
    return;
  }
  // The app may not run to hear the caller hang up: a call still ringing after Udozo's 45 seconds (and a little) is
  // ended here as unanswered, as the API calls it missed.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(50 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:callId];
    for (CXCall *call in [[CXCallObserver alloc] init].calls) {
      if ([call.UUID isEqual:uuid] && !call.hasConnected && !call.hasEnded) [RNCallKeep endCallWithUUID:callId reason:3];
    }
  });
}

@end
`;

const delegateExtension = `
// Udozo's calls (plugins/with-udozo-calls.js): a VoIP push is reported to CallKit at once, as Apple requires.
extension AppDelegate: PKPushRegistryDelegate {
  func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    UdozoCallPush.update(pushCredentials, type: type.rawValue)
  }

  func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {}

  func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    UdozoCallPush.receive(payload, type: type.rawValue, completion: completion)
  }
}
`;

/** The Swift AppDelegate with PushKit: registered at launch, and the delegate's methods in an extension. Idempotent. */
function appDelegateWithCalls(contents) {
  let result = contents;
  if (!result.includes('import PushKit')) result = result.replace(/^import React$/m, 'import PushKit\nimport React');
  if (!result.includes('UdozoCallPush.registerForCalls()')) {
    const launch = /(\n\s*)return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/;
    if (!launch.test(result)) throw new Error('with-udozo-calls: the AppDelegate has no didFinishLaunching to register for calls in.');
    result = result.replace(launch, '$1UdozoCallPush.registerForCalls()$&');
  }
  if (!result.includes('PKPushRegistryDelegate')) result = `${result.trimEnd()}\n${delegateExtension}`;
  return result;
}

/** UdozoCallPush.h and .m in the app's folder, and the header in its Swift bridging header. Idempotent. */
function writeCallPush(folder) {
  fs.writeFileSync(path.join(folder, 'UdozoCallPush.h'), header);
  fs.writeFileSync(path.join(folder, 'UdozoCallPush.m'), source);
  const bridging = fs.readdirSync(folder).find(file => file.endsWith('-Bridging-Header.h'));
  if (!bridging) throw new Error('with-udozo-calls: the Swift bridging header was not found.');
  const file = path.join(folder, bridging);
  const contents = fs.readFileSync(file, 'utf8');
  if (!contents.includes('UdozoCallPush.h')) fs.writeFileSync(file, `${contents.trimEnd()}\n#import "UdozoCallPush.h"\n`);
}

function withIosCalls(config) {
  config = withInfoPlist(config, mod => {
    const modes = new Set(Array.isArray(mod.modResults.UIBackgroundModes) ? mod.modResults.UIBackgroundModes : []);
    modes.add('voip');
    modes.add('audio');
    mod.modResults.UIBackgroundModes = [...modes];
    return mod;
  });
  // UdozoCallPush.h and .m beside the AppDelegate (the .m compiled, the .h found beside the bridging header that imports it).
  config = withDangerousMod(config, [
    'ios',
    async mod => {
      writeCallPush(path.join(mod.modRequest.platformProjectRoot, mod.modRequest.projectName));
      return mod;
    },
  ]);
  config = withXcodeProject(config, mod => {
    const group = mod.modRequest.projectName;
    const project = mod.modResults;
    if (!project.hasFile(`${group}/UdozoCallPush.m`)) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: `${group}/UdozoCallPush.m`, groupName: group, project });
    }
    return mod;
  });
  config = withAppDelegate(config, mod => {
    if (mod.modResults.language !== 'swift') throw new Error('with-udozo-calls: the AppDelegate is expected in Swift.');
    mod.modResults.contents = appDelegateWithCalls(mod.modResults.contents);
    return mod;
  });
  return config;
}

/**
 * Permissions CallKeep's own plugin adds for its managed mode, and react-native-webrtc's for drawing over other apps,
 * which this app does not use.
 */
const callKeepServices = ['io.wazo.callkeep.RNCallKeepBackgroundMessagingService', 'io.wazo.callkeep.VoiceConnectionService'];
const unused = ['android.permission.CALL_PHONE', 'android.permission.READ_PHONE_NUMBERS', 'android.permission.READ_PHONE_STATE', 'android.permission.SYSTEM_ALERT_WINDOW'];

const webrtcRules = '# Udozo calls: WebRTC\n-keep class org.webrtc.** { *; }\n-dontwarn org.webrtc.**';

function withAndroidCalls(config) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.MANAGE_OWN_CALLS',
    'android.permission.RECORD_AUDIO',
    'android.permission.MODIFY_AUDIO_SETTINGS',
    'android.permission.FOREGROUND_SERVICE',
    'android.permission.FOREGROUND_SERVICE_PHONE_CALL',
    'android.permission.FOREGROUND_SERVICE_MICROPHONE',
    'android.permission.WAKE_LOCK',
  ]);
  // Left out, and removed even where a library's own manifest asks for them (`tools:node="remove"`).
  const android = config.android ?? {};
  config.android = {
    ...android,
    permissions: (android.permissions ?? []).filter(name => !unused.includes(name)),
    blockedPermissions: [...new Set([...(android.blockedPermissions ?? []), ...unused])],
  };
  // WebRTC's Java classes are reached from native code, so release shrinking (R8) must keep them, and its optional
  // decoders (Dav1d) are not shipped: without these rules the release build fails on the missing classes.
  config = withDangerousMod(config, [
    'android',
    async mod => {
      const file = path.join(mod.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!current.includes(webrtcRules)) fs.writeFileSync(file, `${current.trimEnd()}\n\n${webrtcRules}\n`);
      return mod;
    },
  ]);
  // CallKeep's services as this app needs them. This runs before CallKeep's own plugin writes the manifest, which adds a
  // service only when it is missing, so these are the ones kept: the ConnectionService labelled Udozo with both service
  // types, and the headless messaging service not exported (only the app itself starts it).
  return withAndroidManifest(config, mod => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.service = (app.service ?? []).filter(service => !callKeepServices.includes(service.$['android:name']));
    app.service.push(
      { $: { 'android:name': 'io.wazo.callkeep.RNCallKeepBackgroundMessagingService', 'android:exported': 'false' } },
      {
        $: {
          'android:name': 'io.wazo.callkeep.VoiceConnectionService',
          'android:exported': 'true',
          'android:label': 'Udozo',
          'android:permission': 'android.permission.BIND_TELECOM_CONNECTION_SERVICE',
          'android:foregroundServiceType': 'phoneCall|microphone',
        },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.telecom.ConnectionService' } }] }],
      },
    );
    return mod;
  });
}

function withUdozoCalls(config) {
  return withAndroidCalls(withIosCalls(config));
}

module.exports = withUdozoCalls;
module.exports.appDelegateWithCalls = appDelegateWithCalls;
module.exports.writeCallPush = writeCallPush;
module.exports.webrtcRules = webrtcRules;
