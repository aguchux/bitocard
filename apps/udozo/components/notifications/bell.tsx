"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { unreadNotifications } from "@/lib/notification-actions";
import { badgeText } from "@/lib/notifications";

const everyMs = 60_000;

/**
 * The header's bell for a signed-in customer: their inbox, badged with what they have not read. The count is read after
 * the page draws, again every minute while the tab is shown and on each new page, so it never slows a page down.
 */
export function NotificationBell() {
  const [count, setCount] = useState(0);
  const path = usePathname();
  useEffect(() => {
    let live = true;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      unreadNotifications().then(next => live && setCount(next)).catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, everyMs);
    document.addEventListener("visibilitychange", read);
    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [path]);
  return (
    <Link
      href="/account/notifications"
      aria-label={count ? `Notifications, ${count} unread` : "Notifications"}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-navy-900 hover:bg-navy-50"
    >
      <Bell className="size-6" aria-hidden="true" />
      {count ? (
        <span className="absolute top-1 right-0.5 min-w-5 rounded-full bg-brand-500 px-1 text-center text-[11px] leading-5 font-bold text-white">{badgeText(count)}</span>
      ) : null}
    </Link>
  );
}
