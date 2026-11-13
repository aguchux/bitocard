import * as Notifications from 'expo-notifications';
import { AndroidImportance, AndroidNotificationVisibility } from 'expo-notifications';
import { NativeModules, Platform } from 'react-native';
import type { ShopCall } from '@shared/classifieds';

import { api } from '@/lib/api';
import type { CallSystem, PeerConfig, PeerLike, StreamLike } from '@/lib/call-engine';
import { systemCallName, type CallPush } from '@/lib/calls';
import { appVersion } from '@/lib/config';

/**
 * The phone's side of calls: react-native-webrtc for the microphone and the connection, react-native-callkeep for the
 * phone's own call screen (CallKit on iPhones; Android's ConnectionService in self-managed mode, so the app draws the
 * call itself and nobody enables a phone account), and react-native-voip-push-notification for the iPhone's VoIP token.
 * Each needs a development build with its config plugin: in Expo Go (or a test without the stand-ins) calls are not
 * offered (`callsSupported`).
 */

type WebRTC = typeof import('react-native-webrtc');
type CallKeep = typeof import('react-native-callkeep').default;
type VoipPush = typeof import('react-native-voip-push-notification').default;

/** Whether this build has the native parts calls need. */
export const callsSupported = () => Boolean(NativeModules.WebRTCModule && NativeModules.RNCallKeep);

/* eslint-disable @typescript-eslint/no-require-imports -- loaded only where their native modules exist */
const webrtc = (): WebRTC => require('react-native-webrtc');
const callKeep = (): CallKeep => require('react-native-callkeep').default;
const voipPush = (): VoipPush => require('react-native-voip-push-notification').default;
/* eslint-enable @typescript-eslint/no-require-imports */

/** How the phone's call screen names the call: the other side, never a number. */
const handle = 'Udozo';
/** Android's channel for a call ringing while the app is in the background, and the actions on it. */
export const callChannel = 'calls';
export const callCategory = 'udozo_call';
export const answerAction = 'answer';
export const declineAction = 'decline';

let setUp: Promise<void> | null = null;

/** CallKeep's options, once per run (the iPhone's are also set natively before any VoIP push is reported). */
export function setupCallSystem() {
  if (!callsSupported()) return Promise.resolve();
  setUp ??= (async () => {
    const keep = callKeep();
    await keep.setup({
      ios: { appName: 'Udozo', supportsVideo: false, includesCallsInRecents: false, maximumCallGroups: '1', maximumCallsPerCallGroup: '1' },
      android: {
        selfManaged: true,
        alertTitle: 'Calls on Udozo',
        alertDescription: 'Udozo needs to make calls through your phone.',
        cancelButton: 'Not now',
        okButton: 'OK',
        additionalPermissions: [],
        foregroundService: { channelId: 'calls_ongoing', channelName: 'Calls in progress', notificationTitle: 'Udozo call in progress' },
      },
    });
    if (Platform.OS === 'android') {
      keep.setAvailable(true);
      await Notifications.setNotificationChannelAsync(callChannel, {
        name: 'Incoming calls',
        importance: AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 400, 300, 400],
        lockscreenVisibility: AndroidNotificationVisibility.PUBLIC,
      });
      await Notifications.setNotificationCategoryAsync(callCategory, [
        { identifier: declineAction, buttonTitle: 'Decline', options: { opensAppToForeground: false, isDestructive: true } },
        { identifier: answerAction, buttonTitle: 'Answer', options: { opensAppToForeground: true } },
      ]);
    }
  })().catch(error => {
    setUp = null;
    throw error;
  });
  return setUp;
}

/** The microphone: asked for first (Android's runtime permission, iOS's own question), then opened, audio only. */
export async function openMicrophone(): Promise<StreamLike> {
  const { mediaDevices, permissions } = webrtc();
  const allowed = await permissions.request({ name: 'microphone' }).catch(() => false);
  if (!allowed) throw Object.assign(new Error('The microphone was not allowed.'), { name: 'NotAllowedError' });
  return (await mediaDevices.getUserMedia({ audio: true, video: false })) as unknown as StreamLike;
}

/** A peer connection through the relay only. */
export function openPeer(config: PeerConfig): PeerLike {
  const { RTCPeerConnection } = webrtc();
  return new RTCPeerConnection({ iceServers: config.iceServers, iceTransportPolicy: config.iceTransportPolicy }) as unknown as PeerLike;
}

/** Calls the phone's call screen knows of (lower case: CallKit hands them back in upper case). */
const known = new Set<string>();
const key = (callId: string) => callId.toLowerCase();

/** Whether the phone's own call screen is already showing this call (a push reported it). */
export const systemKnows = (callId: string) => known.has(key(callId));
export const systemForget = (callId: string) => void known.delete(key(callId));

/** An incoming call the phone's call screen shows: from a push, or answered in the app's own panel. */
export function showIncoming(callId: string, name: string) {
  if (!callsSupported() || systemKnows(callId)) return;
  known.add(key(callId));
  callKeep().displayIncomingCall(key(callId), handle, name, 'generic', false);
}

/** What the call engine tells the phone, so the call shows as one and its sound goes where a call's does. */
export const nativeCallSystem: CallSystem = {
  outgoing: (call: ShopCall) => {
    if (!callsSupported()) return;
    known.add(key(call.id));
    callKeep().startCall(key(call.id), handle, call.with.name, 'generic', false);
  },
  answered: (call: ShopCall) => {
    void dismissCallNotice(call.id);
    if (!callsSupported()) return;
    // Answered in the app's panel: the phone hears of it (shown first if no push did).
    showIncoming(call.id, call.with.name);
    callKeep().answerIncomingCall(key(call.id));
    if (Platform.OS === 'android') callKeep().setCurrentCallActive(key(call.id));
  },
  connected: (call: ShopCall) => {
    if (!callsSupported()) return;
    if (Platform.OS === 'ios' && call.role === 'caller') callKeep().reportConnectedOutgoingCallWithUUID(key(call.id));
    if (Platform.OS === 'android') callKeep().setCurrentCallActive(key(call.id));
  },
  ended: (callId: string) => {
    void dismissCallNotice(callId);
    if (!callsSupported() || !systemKnows(callId)) return;
    known.delete(key(callId));
    // Reported, not ended by the phone (the API already knows): no second "end" comes back.
    callKeep().reportEndCallWithUUID(key(callId), 2);
  },
  mute: (callId: string, muted: boolean) => {
    if (callsSupported() && systemKnows(callId)) callKeep().setMutedCall(key(callId), muted);
  },
  speaker: (callId: string, on: boolean) => {
    if (!callsSupported()) return;
    if (Platform.OS === 'android') return callKeep().toggleAudioRouteSpeaker(key(callId), on);
    void routeIos(callId, on);
  },
};

/** The iPhone's speaker on, or back to the earpiece (or a headset) by choosing the phone's own microphone again. */
async function routeIos(callId: string, on: boolean) {
  const keep = callKeep();
  if (on) return keep.setAudioRoute(key(callId), 'Speaker').catch(() => undefined);
  const routes = await keep.getAudioRoutes().catch(() => []);
  const route = routes.find(item => item.type !== 'Speaker' && item.name !== 'Speaker');
  if (route) await keep.setAudioRoute(key(callId), route.name).catch(() => undefined);
}

/**
 * A call ringing while the app is in the background on Android (self-managed calls have no system screen): a
 * notification on the loudest channel, with Decline and Answer; Answer opens the app to the call.
 */
export async function showCallNotice(push: Extract<CallPush, { kind: 'call' }>) {
  await setupCallSystem().catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: noticeId(push.callId),
    content: {
      title: `${push.caller} is calling you`,
      body: push.about ? `About “${push.about}”. A private call on Udozo.` : 'A private call on Udozo.',
      data: { kind: 'call', call_id: push.callId },
      categoryIdentifier: callCategory,
      sound: 'default',
      priority: Notifications.AndroidNotificationPriority.MAX,
      sticky: true,
      autoDismiss: true,
    },
    trigger: { channelId: callChannel },
  });
}

export const noticeId = (callId: string) => `call-${key(callId)}`;

export async function dismissCallNotice(callId: string) {
  if (Platform.OS !== 'android') return;
  await Notifications.dismissNotificationAsync(noticeId(callId)).catch(() => undefined);
}

/** A push says a call is ringing for this person, with the app in the background: the phone rings for it. */
export async function ringFromPush(push: Extract<CallPush, { kind: 'call' }>) {
  if (!callsSupported()) return;
  await setupCallSystem().catch(() => undefined);
  showIncoming(push.callId, systemCallName(push));
  if (Platform.OS === 'android') await showCallNotice(push);
}

/** A push says the call stopped ringing here (answered on another phone, or ended): the phone stops too. */
export async function stopFromPush(callId: string) {
  await dismissCallNotice(callId);
  if (!callsSupported() || !systemKnows(callId)) return;
  known.delete(key(callId));
  callKeep().reportEndCallWithUUID(key(callId), 2);
}

/**
 * The iPhone's VoIP token, sent with the other phone tokens (`kind: 'apns_voip'`) each time the app opens signed in,
 * so a call rings even with the app closed. The token comes from PushKit, registered natively at launch.
 */
let voipListening = false;
export function registerVoipPush() {
  if (Platform.OS !== 'ios' || !NativeModules.RNVoipPushNotificationManager) return;
  const voip = voipPush();
  if (!voipListening) {
    voipListening = true;
    voip.addEventListener('register', token => {
      if (typeof token === 'string' && token) void api('/v1/store/account/devices/phone', { body: { kind: 'apns_voip', token, app_version: appVersion } }).catch(() => undefined);
    });
    // VoIP pushes are reported to CallKit natively; the app only needs to know which calls CallKit now shows.
    voip.addEventListener('notification', payload => {
      const callId = (payload as { call_id?: unknown }).call_id;
      if (typeof callId === 'string') known.add(key(callId));
    });
    voip.addEventListener('didLoadWithEvents', events => {
      for (const event of events ?? []) {
        if (event.name === voip.RNVoipPushRemoteNotificationsRegisteredEvent && typeof event.data === 'string') {
          void api('/v1/store/account/devices/phone', { body: { kind: 'apns_voip', token: event.data, app_version: appVersion } }).catch(() => undefined);
        }
        if (event.name === voip.RNVoipPushRemoteNotificationReceivedEvent) {
          const callId = (event.data as { call_id?: unknown }).call_id;
          if (typeof callId === 'string') known.add(key(callId));
        }
      }
    });
  }
  voip.registerVoipToken();
}

/** The phone's call screen, for the provider to listen to (answer, end, mute) while the app runs. */
export const systemCalls = () => (callsSupported() ? callKeep() : null);

/** react-native-webrtc's audio session, told when CallKit hands the call its audio (iPhones). */
export function audioSessionActivated(active: boolean) {
  if (Platform.OS !== 'ios' || !callsSupported()) return;
  const { RTCAudioSession } = webrtc();
  if (active) RTCAudioSession.audioSessionDidActivate();
  else RTCAudioSession.audioSessionDidDeactivate();
}
