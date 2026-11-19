import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from '@/lib/api';
import { appVersion } from '@/lib/config';

/**
 * Push to this phone through BitoCard's own senders (Firebase on Android, APNs on iPhones; never Expo's push service):
 * the phone's token goes to `POST /v1/store/account/devices/phone` each time the app opens signed in. Permission is
 * asked only from Notifications or Settings, never at launch.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export type PushResult = { registered: true } | { registered: false; reason: 'denied' | 'unavailable' };

export async function registerPush({ ask }: { ask: boolean }): Promise<PushResult> {
  try {
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('notices', { name: 'BitoCard notices', importance: AndroidImportance.DEFAULT });
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && ask) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return { registered: false, reason: 'denied' };
    const token = await Notifications.getDevicePushTokenAsync();
    await api('/v1/store/account/devices/phone', { body: { kind: Platform.OS === 'ios' ? 'apns' : 'fcm', token: String(token.data), app_version: appVersion } });
    return { registered: true };
  } catch {
    // No push in this build (Expo Go, no Firebase file) or push not switched on yet: the inbox still works.
    return { registered: false, reason: 'unavailable' };
  }
}

/** Whether this phone already allows notifications (nothing is asked). */
export async function pushAllowed() {
  try {
    return (await Notifications.getPermissionsAsync()).status === 'granted';
  } catch {
    return false;
  }
}

/** The bitocard.com path a notification opens: the API puts it in `link` (FCM's data, or beside APNs' `aps`). */
export function noticeLink(response: Notifications.NotificationResponse): string | null {
  const content = response.notification.request.content.data as Record<string, unknown> | null;
  const trigger = response.notification.request.trigger as { payload?: Record<string, unknown> } | null;
  const link = content?.link ?? trigger?.payload?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}
