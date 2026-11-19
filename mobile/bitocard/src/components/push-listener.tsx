import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';

import { useAccount } from '@/lib/account';
import { appLink } from '@/lib/links';
import { noticeLink, registerPush } from '@/lib/push';

/**
 * While a customer is signed in: this phone's push token is sent again each time the app opens (only if they already
 * allowed notifications; nothing is asked here), a notice arriving refreshes the inbox, and tapping one opens its screen.
 */
export function PushListener() {
  const queries = useQueryClient();
  const { customer } = useAccount();
  const ready = Boolean(customer?.email_verified);

  useEffect(() => {
    if (ready) void registerPush({ ask: false });
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const open = (response: Notifications.NotificationResponse) => {
      const to = appLink(noticeLink(response));
      router.push((to ?? '/notifications') as Href);
    };
    const arrived = Notifications.addNotificationReceivedListener(() => void queries.invalidateQueries({ queryKey: ['notices'] }));
    const tapped = Notifications.addNotificationResponseReceivedListener(open);
    // The notice that opened the app from closed.
    const last = Notifications.getLastNotificationResponse();
    if (last) open(last);
    return () => {
      arrived.remove();
      tapped.remove();
    };
  }, [ready, queries]);

  return null;
}
