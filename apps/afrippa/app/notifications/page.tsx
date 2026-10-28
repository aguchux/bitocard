import type { Metadata } from "next";
import { cardClass, tradeDate } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { openNotification, readAllNotifications } from "@/lib/orders";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

type Notice = { id: string; severity: "info" | "warning" | "critical"; title: string; body: string; link: string | null; mode: "live" | "test" | null; read: boolean; created_at: string };

const tone: Record<Notice["severity"], string> = { info: "bg-slate-300", warning: "bg-amber-500", critical: "bg-red-600" };

/** What Afrippa told the trader (orders, the order room, money, security), newest first; opening one marks it read. */
export default async function NotificationsPage() {
  await requireCustomer("/notifications");
  const result = await customerApi<{ data: Notice[]; unread_count: number }>("GET", "/v1/afrippa/account/notifications?limit=50");
  const notices = result.ok ? result.data.data : [];
  return (
    <AccountShell
      title="Notifications"
      current="/notifications"
      action={
        result.ok && result.data.unread_count ? (
          <form action={readAllNotifications}>
            <button type="submit" className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold ring-1 ring-slate-300 hover:ring-slate-400">
              Mark all read
            </button>
          </form>
        ) : null
      }
    >
      {!result.ok ? (
        <p className={cardClass}>Your notifications cannot be shown right now. Try again shortly.</p>
      ) : notices.length ? (
        <ul className="space-y-2" aria-label="Your notifications">
          {notices.map(notice => (
            <li key={notice.id}>
              <form action={openNotification}>
                <input type="hidden" name="id" value={notice.id} />
                <input type="hidden" name="link" value={notice.link ?? "/notifications"} />
                <button type="submit" className={`${cardClass} flex w-full items-start gap-3 text-left hover:ring-slate-300 ${notice.read ? "" : "bg-brand-50/40"}`}>
                  <span aria-hidden="true" className={`mt-1.5 size-2.5 shrink-0 rounded-full ${notice.read ? "bg-transparent" : tone[notice.severity]}`} />
                  <span className="min-w-0">
                    <span className="block font-semibold">
                      {notice.title}
                      {notice.mode === "test" ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">Sandbox</span> : null}
                      {notice.read ? null : <span className="sr-only"> (unread)</span>}
                    </span>
                    <span className="block text-sm text-slate-600">{notice.body}</span>
                    <span className="block text-xs text-slate-400">{tradeDate(notice.created_at)}</span>
                  </span>
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className={cardClass}>Nothing yet. We tell you here when an order moves, someone writes in its room, or money arrives.</p>
      )}
    </AccountShell>
  );
}
