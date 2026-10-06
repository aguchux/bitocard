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
    // Both show as read at once (the inbox and the bell's count), undone if the API refuses; the lists are then
    // refetched to match the server.
    markNotificationRead: build.mutation<InboxNotification, { realm: NotificationRealm; id: string }>({
      query: ({ realm, id }) => ({ url: `${base(realm)}/${id}/read`, method: 'POST' }),
      async onQueryStarted({ realm, id }, { dispatch, getState, queryFulfilled }) {
        const undo = markRead(dispatch, getState, realm, id);
        await queryFulfilled.catch(undo);
      },
      invalidatesTags: ['Notification'],
    }),
    markAllNotificationsRead: build.mutation<{ object: 'notifications_read'; updated: number }, NotificationRealm>({
      query: realm => ({ url: `${base(realm)}/read-all`, method: 'POST' }),
      async onQueryStarted(realm, { dispatch, getState, queryFulfilled }) {
        const undo = markRead(dispatch, getState, realm, 'all');
        await queryFulfilled.catch(undo);
      },
      invalidatesTags: ['Notification'],
    }),
  }),
});

type Dispatch = (action: unknown) => unknown;
type Patch = { undo: () => void };

/** Marks one cached notification of a realm read (or `all` of them), and lowers its unread count; returns the undo. */
function markRead(dispatch: Dispatch, getState: () => unknown, realm: NotificationRealm, which: string) {
  const matches = (item: InboxNotification) => which === 'all' || item.id === which;
  const state = getState() as Parameters<typeof notificationsApi.util.selectCachedArgsForQuery>[0];
  const now = new Date().toISOString();
  let marked = 0;
  const patches: Patch[] = [];
  for (const args of notificationsApi.util.selectCachedArgsForQuery(state, 'notifications')) {
    if (args.realm !== realm) continue;
    let markedHere = 0;
    patches.push(
      dispatch(
        notificationsApi.util.updateQueryData('notifications', args, draft => {
          for (const item of draft.pages.flatMap(page => page.data)) {
            if (!item.read && matches(item)) {
              item.read = true;
              item.read_at = now;
              markedHere++;
            }
          }
          // Every page carries the same total.
          for (const page of draft.pages) page.unread_count = which === 'all' ? 0 : Math.max(0, page.unread_count - markedHere);
        }),
      ) as Patch,
    );
    marked = Math.max(marked, markedHere);
  }
  // Marking all read empties the count even when the unread ones are not loaded on this screen; one notification
  // lowers it only if it was loaded and unread (otherwise the refetch after saving sets it).
  patches.push(
    dispatch(
      notificationsApi.util.updateQueryData('unreadNotifications', realm, draft => {
        draft.count = which === 'all' ? 0 : Math.max(0, draft.count - marked);
      }),
    ) as Patch,
  );
  return () => patches.forEach(patch => patch.undo());
}

export const { useNotificationsInfiniteQuery, useUnreadNotificationsQuery, useMarkNotificationReadMutation, useMarkAllNotificationsReadMutation } = notificationsApi;
