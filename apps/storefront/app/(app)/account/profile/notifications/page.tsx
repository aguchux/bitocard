import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountScreen } from "@/components/app/account-menu";
import { NotificationList } from "@/components/app/notifications/inbox";
import { PushControls } from "@/components/app/notifications/push-controls";
import { currentCustomer, customerApi } from "@/lib/customer";
import { pushState } from "@/lib/notification-actions";
import type { NotificationPage } from "@/lib/notifications";

export const metadata: Metadata = { title: "Notifications", robots: { index: false, follow: false } };

const path = "/account/profile/notifications";
const empty = "rounded-3xl bg-white p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200/70";
const pageLink = "inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-slate-300";
const uuid = /^[0-9a-f-]{36}$/i;

/**
 * What the store told the customer about their orders, wallet, sold gift cards and account, newest first, 30 a page,
 * each opening its page; then notifications on this device and which ones are sent there.
 */
export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  if (!(await currentCustomer())) redirect(`/signin?next=${encodeURIComponent(path)}`);
  const { after } = await searchParams;
  const cursor = after && uuid.test(after) ? after : null;
  const [page, push] = await Promise.all([
    customerApi<NotificationPage>("GET", `/v1/store/account/notifications?limit=30${cursor ? `&starting_after=${cursor}` : ""}`),
    pushState(),
  ]);
  const notices = page.ok ? page.data.data : [];

  return (
    <AccountScreen title="Notifications" lead="What happens with your orders, wallet and account.">
      {!page.ok ? (
        <p className={empty}>Your notifications could not be loaded just now. Try again shortly.</p>
      ) : notices.length ? (
        <NotificationList key={cursor ?? "first"} notices={notices} />
      ) : (
        <p className={empty}>{cursor ? "No older notifications." : "Nothing yet. We will tell you here when something happens with your orders or account."}</p>
      )}
      {page.ok && (cursor || page.data.has_more) ? (
        <nav aria-label="More notifications" className="flex gap-3">
          {cursor ? (
            <Link href={path} className={pageLink}>
              Latest
            </Link>
          ) : null}
          {page.data.has_more && notices.length ? (
            <Link href={`${path}?after=${notices.at(-1)!.id}`} className={pageLink}>
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
      {push?.enabled && push.publicKey ? (
        <section className="grid gap-3 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 sm:p-6" aria-labelledby="push-heading">
          <h2 id="push-heading" className="text-lg font-bold text-navy-900">
            Notifications on this device
          </h2>
          <PushControls publicKey={push.publicKey} devices={push.devices} preferences={push.preferences} />
        </section>
      ) : null}
    </AccountScreen>
  );
}
