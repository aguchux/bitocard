"use client";

import { useParams } from "next/navigation";
import { Card, CardHeader, formatDateTime, formatMoney, KeyValue, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { UdozoShell } from "@/components/shell";
import { udozoOrigin } from "@/components/theme";
import { type AdminBuyOrderDetail, useBuyOrderQuery } from "@bitocard/api-client/admin";
import { BuyOrderStatusBadge, buyOrderPartyLabels, completedByLabels } from "@/components/buy-orders";

const when = (value: string | null) => (value ? formatDateTime(value) : "—");

/** One buy order: what was asked, where it stands, the two people, the ad, and every step taken. Read only. */
export default function BuyOrderPage() {
  const { id } = useParams<{ id: string }>();
  const order = useBuyOrderQuery(id);
  return (
    <UdozoShell
      section="marketplace"
      current="/classifieds/buy-orders"
      crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Buy orders", href: "/classifieds/buy-orders" }, { label: order.data?.number ?? "Buy order" }]}
    >
      <QueryView query={order} loading={<Skeleton className="h-96 w-full" />}>
        {data => <Detail order={data} />}
      </QueryView>
    </UdozoShell>
  );
}

function Detail({ order }: { order: AdminBuyOrderDetail }) {
  const money = (minor: number | null) => (minor === null ? "—" : formatMoney(minor, order.currency));
  const ended = order.ended_by ? `${buyOrderPartyLabels[order.ended_by]}${order.end_reason ? `: ${order.end_reason}` : ""}` : null;
  return (
    <>
      <PageHeader title={order.number} description={`Asked ${formatDateTime(order.created_at)} · ${order.country}`} actions={<BuyOrderStatusBadge status={order.status} />} />
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="The buy order" />
            <div className="px-5 pb-5 sm:px-6">
              <KeyValue
                items={[
                  { label: "Price asked", value: money(order.price) },
                  { label: "How many", value: String(order.quantity) },
                  { label: "Seller's counter", value: order.counter === null ? "No counter" : money(order.counter) },
                  { label: "Buyer's note", value: order.note ?? "—" },
                  { label: "Where and when to meet", value: order.meet_note ?? "—" },
                  { label: "Seller to answer by", value: when(order.respond_by) },
                  { label: "Accepted", value: when(order.accepted_at) },
                  { label: "To meet by", value: when(order.meet_by) },
                  { label: "Buyer said they bought it", value: when(order.bought_at) },
                  { label: "Completed", value: order.completed_at ? `${formatDateTime(order.completed_at)}${order.completed_by ? ` · ${completedByLabels[order.completed_by]}` : ""}` : "—" },
                  { label: "Buyer said they did not buy it", value: order.voided_at ? `${formatDateTime(order.voided_at)}${order.void_reason ? ` · ${order.void_reason}` : ""}` : "—" },
                  { label: "Ended by", value: ended ?? "—" },
                  { label: "Last changed", value: formatDateTime(order.updated_at) },
                ]}
              />
            </div>
          </Card>
          <Card>
            <CardHeader title="Steps" description="Oldest first." />
            <div className="px-5 pb-5 sm:px-6">
              {order.steps.length ? (
                <ol className="space-y-4 border-l-2 border-line pl-4">
                  {order.steps.map((step, index) => (
                    <li key={`${step.at}:${index}`} className="relative">
                      <span aria-hidden className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-brand-600" />
                      <span className="block text-sm font-semibold text-ink">{buyOrderPartyLabels[step.by] ?? step.by}</span>
                      <span className="block break-words text-sm text-ink">{step.text}</span>
                      <span className="block text-xs text-muted">{formatDateTime(step.at)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted">No steps recorded.</p>
              )}
            </div>
          </Card>
        </div>
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="The ad" />
            <div className="grid gap-2 px-5 pb-5 text-sm sm:px-6">
              <span className="break-words font-semibold text-ink">{order.listing.title ?? `Ad #${order.listing.ref}`}</span>
              <span className="text-muted">
                #{order.listing.ref} · {order.listing.status}
              </span>
              <AppLink href={`/classifieds/listings/${order.listing.id}`} className="w-fit font-semibold text-brand-600 hover:underline">
                Open the ad here
              </AppLink>
              <a href={`${udozoOrigin()}${order.listing.path}`} target="_blank" rel="noopener" className="w-fit font-semibold text-brand-600 hover:underline">
                Open it on udozo.com
              </a>
            </div>
          </Card>
          <Person title="Buyer" person={order.buyer} />
          <Person title="Seller" person={order.seller} />
        </div>
      </div>
    </>
  );
}

function Person({ title, person }: { title: string; person: { id: string; name: string; email: string } }) {
  return (
    <Card>
      <CardHeader title={title} />
      <div className="grid gap-1 px-5 pb-5 text-sm sm:px-6">
        <span className="break-words font-semibold text-ink">{person.name}</span>
        <span className="break-all text-muted">{person.email}</span>
        <AppLink href={`/classifieds/sellers/${person.id}`} className="mt-1 w-fit font-semibold text-brand-600 hover:underline">
          Open their marketplace page
        </AppLink>
        <AppLink href={`/customers/${person.id}`} className="w-fit font-semibold text-brand-600 hover:underline">
          Open their Udozo account
        </AppLink>
      </div>
    </Card>
  );
}
