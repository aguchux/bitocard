import { bitocardApi } from './base';
import type { NotificationRealm, NotificationSeverity } from './notifications';

/** A browser registered for push notifications, with its own ID. `current`: this browser's session registered it. */
export type PushDevice = {
  object: 'device';
  id: string;
  channel: 'web_push';
  label: string;
  current: boolean;
  last_pushed_at: string | null;
  last_seen_at: string;
  created_at: string;
};

export type PushSettings = { object: 'push_settings'; enabled: boolean; public_key: string | null };

/** Whether one notification type is pushed to your devices. `locked`: urgent or security, always pushed. */
export type NotificationPreference = {
  object: 'notification_preference';
  type: string;
  label: string;
  severity: NotificationSeverity;
  push: boolean;
  default: boolean;
  locked: boolean;
};

/** A browser's push subscription, as `PushSubscription.toJSON()` gives it. */
export type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };

const base = (realm: NotificationRealm) => (realm === 'admin' ? '/v1/admin' : '/v1');

/** Push to your own devices, in SHQ and the admin app. */
export const pushApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    // Push keys are integration settings: saving one refreshes this.
    pushSettings: build.query<PushSettings, NotificationRealm>({ query: realm => `${base(realm)}/devices/push-settings`, providesTags: ['Integration'] }),
    pushDevices: build.query<{ object: 'list'; data: PushDevice[] }, NotificationRealm>({ query: realm => `${base(realm)}/devices`, providesTags: ['Device'] }),
    registerPushDevice: build.mutation<PushDevice, { realm: NotificationRealm; subscription: PushSubscriptionInput }>({
      query: ({ realm, subscription }) => ({ url: `${base(realm)}/devices`, method: 'POST', body: subscription }),
      invalidatesTags: ['Device'],
    }),
    testPushDevice: build.mutation<{ object: 'push_test'; sent: boolean; error: string | null }, { realm: NotificationRealm; id: string }>({
      query: ({ realm, id }) => ({ url: `${base(realm)}/devices/${id}/test`, method: 'POST' }),
      invalidatesTags: ['Device'],
    }),
    removePushDevice: build.mutation<void, { realm: NotificationRealm; id: string }>({
      query: ({ realm, id }) => ({ url: `${base(realm)}/devices/${id}`, method: 'DELETE' }),
      invalidatesTags: ['Device'],
    }),
    notificationPreferences: build.query<{ object: 'list'; data: NotificationPreference[] }, NotificationRealm>({
      query: realm => `${base(realm)}/notification-preferences`,
      providesTags: ['NotificationPreference'],
    }),
    setNotificationPreference: build.mutation<NotificationPreference, { realm: NotificationRealm; type: string; push: boolean }>({
      query: ({ realm, type, push }) => ({ url: `${base(realm)}/notification-preferences/${encodeURIComponent(type)}`, method: 'PUT', body: { push } }),
      invalidatesTags: ['NotificationPreference'],
    }),
  }),
});

export const {
  usePushSettingsQuery,
  usePushDevicesQuery,
  useRegisterPushDeviceMutation,
  useTestPushDeviceMutation,
  useRemovePushDeviceMutation,
  useNotificationPreferencesQuery,
  useSetNotificationPreferenceMutation,
} = pushApi;
