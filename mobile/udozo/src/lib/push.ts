import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { callPush } from '@/lib/calls';
import { appVersion } from '@/lib/config';

/**
 * Push to this phone through the API's own senders (Firebase on Android, APNs on iPhones; no other push service):
 * the phone's own token goes to `POST /v1/store/account/devices/phone`, each time the app opens signed in, which also
 * keeps the phone counted for calls. Permission is asked only when it helps (after a first chat, or from Notifications
 * and Settings), never at launch.
 */

// A call's push with the app open shows nothing: the call panel already rings (src/components/calls).
Notifications.setNotificationHandler({
  handleNotification: async notification => {
    const call = callPush(notification.request.content.data) ?? callPush((notification.request.trigger as { remoteMessage?: { data?: unknown } } | null)?.remoteMessage?.data);
    return call ? { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false } : { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false };
  },
});

export async function registerPush({ ask }: { ask: boolean }) {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('notices', { name: 'Udozo notices', importance: AndroidImportance.DEFAULT });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return { registered: false as const, status };
  // The phone's own token (FCM or APNs), never Expo's push service.
  const token = await Notifications.getDevicePushTokenAsync();
  await api('/v1/store/account/devices/phone', {
    body: { kind: Platform.OS === 'ios' ? 'apns' : 'fcm', token: String(token.data), app_version: appVersion },
  });
  return { registered: true as const, status };
}

/** The udozo.com path a notification opens: the API puts it in `link` (FCM's data, or beside APNs' `aps`). */
export function noticeLink(response: Notifications.NotificationResponse): string | null {
  const content = response.notification.request.content.data as Record<string, unknown> | null;
  const trigger = response.notification.request.trigger as { payload?: Record<string, unknown> } | null;
  const link = content?.link ?? trigger?.payload?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}
