'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import {
  type InboxNotification,
  type NotificationRealm,
  type NotificationSeverity,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationReadMutation,
  useNotificationsInfiniteQuery,
  useUnreadNotificationsQuery,
} from '@bitocard/api-client';
import { cn, errorMessage, formatDateTime, formatRelative } from '../format';
import { LoadMore, Tabs } from '../ui/data';
import { Badge, EmptyState, ErrorState, RefreshFailed } from '../ui/status';
import { usePushSync } from './push';
import { AppLink } from './session';

/** How often the unread count is refreshed while the tab is visible. */
export const unreadPollMs = 60_000;

const severityIcons: Record<NotificationSeverity, { icon: typeof Info; className: string; label: string }> = {
  info: { icon: Info, className: 'bg-blue-50 text-blue-600', label: 'Information' },
  success: { icon: CheckCircle2, className: 'bg-emerald-50 text-emerald-600', label: 'Done' },
  warning: { icon: AlertTriangle, className: 'bg-amber-50 text-amber-600', label: 'Needs attention' },
  critical: { icon: OctagonAlert, className: 'bg-red-50 text-red-600', label: 'Urgent' },
};

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  const { icon: Icon, className, label } = severityIcons[severity];
  return (
    <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', className)}>
      <Icon className="size-[18px]" aria-label={label} />
    </span>
  );
}

/** One notification: opening it marks it read and goes to its page. */
function Item({ item, realm, onOpen, compact }: { item: InboxNotification; realm: NotificationRealm; onOpen?: () => void; compact?: boolean }) {
  const [markRead] = useMarkNotificationReadMutation();
  const open = () => {
    if (!item.read) void markRead({ realm, id: item.id });
    onOpen?.();
  };
  const content = (
    <>
      <SeverityIcon severity={item.severity} />
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn('text-sm text-ink', item.read ? 'font-medium' : 'font-bold')}>{item.title}</span>
          {item.mode === 'test' ? (
            <Badge tone="amber" dot={false}>
              Sandbox
            </Badge>
          ) : null}
        </span>
        <span className={cn('block text-sm text-muted', compact && 'line-clamp-2')}>{item.body}</span>
        <span className="block text-xs text-subtle" title={formatDateTime(item.created_at)}>
          {formatRelative(item.created_at)}
        </span>
      </span>
      {item.read ? null : <span aria-label="Unread" className="mt-1.5 size-2.5 shrink-0 rounded-full bg-brand-500" />}
    </>
  );
  const className = cn('flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left hover:bg-canvas', !item.read && 'bg-brand-50/40');
  return item.link ? (
    <AppLink href={item.link} onClick={open} className={className}>
      {content}
    </AppLink>
  ) : (
    <button type="button" onClick={open} className={className}>
      {content}
    </button>
  );
}

/**
 * The bell in the header: the unread count, and the latest notifications in a menu. With `userId`, it also keeps this
 * browser registered for push if that person turned push on here.
 */
export function NotificationBell({ realm, href = '/notifications', userId }: { realm: NotificationRealm; href?: string; userId?: string }) {
  usePushSync(realm, userId);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data: unread } = useUnreadNotificationsQuery(realm, { pollingInterval: unreadPollMs, skipPollingIfUnfocused: true });
  const latest = useNotificationsInfiniteQuery({ realm, limit: 8 }, { skip: !open });
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();
  const count = unread?.count ?? 0;
  const items = latest.data?.pages[0]?.data ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative grid size-11 place-items-center rounded-xl text-ink hover:bg-canvas"
      >
        <Bell className="size-5" aria-hidden />
        {count ? (
          <span aria-hidden className="absolute top-1.5 right-1.5 grid min-w-5 place-items-center rounded-full bg-brand-500 px-1 text-[11px] leading-5 font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        ) : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="fixed inset-x-2 top-16 z-30 rounded-2xl border border-line bg-white shadow-xl sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <p className="text-sm font-bold text-ink">Notifications</p>
            {count ? (
              <button
                type="button"
                disabled={marking}
                onClick={() => void markAll(realm)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-brand-600 hover:bg-brand-50"
              >
                <CheckCheck className="size-4" aria-hidden />
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="max-h-[60svh] overflow-y-auto p-2">
            {latest.data && latest.error && !latest.isFetching ? (
              <RefreshFailed message={errorMessage(latest.error, 'Could not load your notifications.')} onRetry={() => void latest.refetch()} />
            ) : null}
            {!latest.data && latest.isLoading ? (
              <p className="px-3 py-6 text-center text-sm text-muted">Loading…</p>
            ) : !latest.data && latest.error ? (
              <p className="px-3 py-6 text-center text-sm text-red-600">{errorMessage(latest.error, 'Could not load your notifications.')}</p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted">You are all caught up.</p>
            ) : (
              items.map(item => <Item key={item.id} item={item} realm={realm} compact onOpen={() => setOpen(false)} />)
            )}
          </div>
          <div className="border-t border-line p-2">
            <AppLink href={href} onClick={() => setOpen(false)} className="flex min-h-10 items-center justify-center rounded-xl text-sm font-semibold text-brand-600 hover:bg-brand-50">
              See all notifications
            </AppLink>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The full inbox page: all or unread, newest first, with Load more and Mark all read. */
export function NotificationsInbox({ realm }: { realm: NotificationRealm }) {
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const query = useNotificationsInfiniteQuery({ realm, unread: filter === 'unread', limit: 25 });
  const [markAll, { isLoading: marking }] = useMarkAllNotificationsReadMutation();
  const items = query.data?.pages.flatMap(page => page.data) ?? [];
  const unread = query.data?.pages[0]?.unread_count ?? 0;

  return (
    <section className="rounded-2xl border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 pt-2 sm:px-6">
        <Tabs
          label="Show"
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread', count: unread || undefined },
          ]}
        />
        <button
          type="button"
          disabled={marking || unread === 0}
          onClick={() => void markAll(realm)}
          className="mb-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-50"
        >
          <CheckCheck className="size-4" aria-hidden />
          Mark all read
        </button>
      </div>
      {query.data && query.error && !query.isFetching ? (
        <div className="px-4 pt-4">
          <RefreshFailed message={errorMessage(query.error, 'Could not load your notifications.')} onRetry={() => void query.refetch()} />
        </div>
      ) : null}
      {!query.data && query.error ? (
        <div className="p-4">
          <ErrorState message={errorMessage(query.error, 'Could not load your notifications.')} onRetry={query.refetch} />
        </div>
      ) : !query.data && query.isLoading ? (
        <p className="p-6 text-center text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="p-4">
          <EmptyState title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} icon={<Bell className="size-6" aria-hidden />}>
            What needs your attention appears here, for your role. Notifications are kept for 90 days.
          </EmptyState>
        </div>
      ) : (
        <div className="divide-y divide-line px-2 py-2 sm:px-4">
          {items.map(item => (
            <Item key={item.id} item={item} realm={realm} />
          ))}
        </div>
      )}
      <LoadMore hasMore={query.hasNextPage} loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()} />
    </section>
  );
}
