import type { Metadata } from "next";
import Link from "next/link";
import { PageTitle } from "@/components/account/nav";
import { NotificationList } from "@/components/notifications/inbox";
import { PushControls } from "@/components/notifications/push-controls";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { pushState } from "@/lib/notification-actions";
import type { NotificationPage } from "@/lib/notifications";

export const metadata: Metadata = { title: "Notifications" };

const empty = "rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600";
const uuid = /^[0-9a-f-]{36}$/i;

/**
 * What Udozo told the customer about their listings, chats, requests, orders, reviews, payouts and account, newest
 * first, 30 a page, each opening its page; then push for this browser and which notices are pushed.
 */
export default async function Notifications({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  await requireCustomer("/account/notifications");
  const { after } = await searchParams;
  const cursor = after && uuid.test(after) ? after : null;
  const [page, push] = await Promise.all([
    customerApi<NotificationPage>("GET", `/v1/store/account/notifications?limit=30${cursor ? `&starting_after=${cursor}` : ""}`),
    pushState(),
  ]);
  const notices = page.ok ? page.data.data : [];
  return (
    <div className="grid gap-6">
      <PageTitle title="Notifications" note="What happens with your listings, chats, orders and account." post={false} />
      {!page.ok ? (
        <p className={empty}>Your notifications could not be loaded just now. Try again shortly.</p>
      ) : notices.length ? (
        <NotificationList key={cursor ?? "first"} notices={notices} />
      ) : (
        <p className={empty}>{cursor ? "No older notifications." : "Nothing yet. We will tell you here when something needs you."}</p>
      )}
      {page.ok && (cursor || page.data.has_more) ? (
        <nav aria-label="More notifications" className="flex gap-3">
          {cursor ? (
            <Link href="/account/notifications" className="inline-flex min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-900">
              Latest
            </Link>
          ) : null}
          {page.data.has_more && notices.length ? (
            <Link href={`/account/notifications?after=${notices.at(-1)!.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-900">
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
      {push?.enabled && push.publicKey ? (
        <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby="push-heading">
          <h2 id="push-heading" className="text-lg font-bold text-navy-900">
            Notifications on this device
          </h2>
          <PushControls publicKey={push.publicKey} devices={push.devices} preferences={push.preferences} />
        </section>
      ) : null}
    </div>
  );
}
