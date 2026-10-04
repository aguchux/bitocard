import { bitocardApi } from './base';

/** Which app's inbox: SHQ (`/v1/notifications`) or the admin app (`/v1/admin/notifications`). */
export type NotificationRealm = 'reseller' | 'admin';
export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

/** One in-app notification for the signed-in person. `link` is a path in their own app. */
export type InboxNotification = {
  object: 'notification';
  id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: string | null;
  /** `test` for sandbox notifications; null when the mode does not apply. */
  mode: 'live' | 'test' | null;
  read: boolean;
  read_at: string | null;
  created_at: string;
};

export type NotificationPage = { object: 'list'; data: InboxNotification[]; has_more: boolean; unread_count: number };

const base = (realm: NotificationRealm) => (realm === 'admin' ? '/v1/admin/notifications' : '/v1/notifications');
const clean = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== '' && value !== false));

/** The inbox, shared by SHQ and the admin app: each person reads their own. */
export const notificationsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    notifications: build.infiniteQuery<NotificationPage, { realm: NotificationRealm; unread?: boolean; limit?: number }, string>({
      infiniteQueryOptions: { initialPageParam: '', getNextPageParam: last => (last.has_more ? last.data.at(-1)?.id : undefined) },
      query: ({ queryArg: { realm, ...filter }, pageParam }) => {
        const params = clean({ ...filter, starting_after: pageParam });
        return Object.keys(params).length ? { url: base(realm), params } : base(realm);
      },
      providesTags: [{ type: 'Notification', id: 'LIST' }],
    }),
    unreadNotifications: build.query<{ object: 'unread_count'; count: number }, NotificationRealm>({
      query: realm => `${base(realm)}/unread-count`,
      providesTags: [{ type: 'Notification', id: 'COUNT' }],
    }),
    markNotificationRead: build.mutation<InboxNotification, { realm: NotificationRealm; id: string }>({
      query: ({ realm, id }) => ({ url: `${base(realm)}/${id}/read`, method: 'POST' }),
      invalidatesTags: ['Notification'],
    }),
    markAllNotificationsRead: build.mutation<{ object: 'notifications_read'; updated: number }, NotificationRealm>({
      query: realm => ({ url: `${base(realm)}/read-all`, method: 'POST' }),
      invalidatesTags: ['Notification'],
    }),
  }),
});

export const { useNotificationsInfiniteQuery, useUnreadNotificationsQuery, useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation } = notificationsApi;
