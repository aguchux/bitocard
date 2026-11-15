"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { readAllNotifications, readNotification } from "@/lib/notification-actions";
import { type CustomerNotification, noticeHref, noticeWhen } from "@/lib/notifications";

const tone: Record<CustomerNotification["severity"], string> = {
  info: "bg-navy-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-600",
};

/** The customer's notices, newest first: opening one marks it read and goes to its page; Mark all read clears the rest. */
export function NotificationList({ notices }: { notices: CustomerNotification[] }) {
  const router = useRouter();
  const [read, setRead] = useState<Set<string>>(() => new Set(notices.filter(notice => notice.read).map(notice => notice.id)));
  const [pending, start] = useTransition();
  const unread = notices.filter(notice => !read.has(notice.id)).length;

  const open = (notice: CustomerNotification) => {
    if (read.has(notice.id)) return;
    setRead(current => new Set(current).add(notice.id));
    void readNotification(notice.id);
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">{unread ? `${unread} unread` : "All read"}</p>
        {unread ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const done = await readAllNotifications();
                if (done.ok) {
                  setRead(new Set(notices.map(notice => notice.id)));
                  router.refresh();
                }
              })
            }
            className="min-h-11 rounded-xl border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-navy-300 disabled:opacity-60"
          >
            Mark all read
          </button>
        ) : null}
      </div>
      <ul className="grid gap-2">
        {notices.map(notice => {
          const isRead = read.has(notice.id);
          return (
            <li key={notice.id}>
              <Link
                href={noticeHref(notice.link)}
                onClick={() => open(notice)}
                className={`flex gap-3 rounded-2xl border p-4 hover:border-navy-300 ${isRead ? "border-slate-200 bg-white" : "border-navy-200 bg-navy-50"}`}
              >
                <span className={`mt-1.5 size-2.5 shrink-0 rounded-full ${isRead ? "bg-transparent" : tone[notice.severity]}`} aria-hidden="true" />
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="flex items-start justify-between gap-3">
                    <span className={`min-w-0 text-[15px] ${isRead ? "font-semibold" : "font-bold"} text-navy-900`}>
                      {notice.title}
                      {isRead ? null : <span className="sr-only"> (unread)</span>}
                    </span>
                    <time dateTime={notice.created_at} className="shrink-0 text-xs text-slate-500">
                      {noticeWhen(notice.created_at)}
                    </time>
                  </span>
                  {notice.body ? <span className="text-sm text-slate-600">{notice.body}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
