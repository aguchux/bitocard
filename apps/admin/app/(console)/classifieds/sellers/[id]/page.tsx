"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, errorMessage, formatDateTime, formatNumber, KeyValue, Notice, PageHeader, QueryView, Skeleton, StatCard, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type AdminClassifiedListing,
  type ClassifiedSellerDetail,
  useClassifiedListingsQuery,
  useClassifiedSellerQuery,
  useClearClassifiedStrikesMutation,
  useSetClassifiedSellerSuspendedMutation,
} from "@bitocard/api-client/admin";
import { Ban, Flag, HandCoins, Package } from "lucide-react";
import { ListingCell, ListingStatus, listingPrice, reportReasonLabels } from "@/components/classifieds";

type Action = "suspend" | "unsuspend" | "clear";

/**
 * One BitoCard Shop seller: their ads, reports about them or their ads, and their Safe pay standing (strikes over 90
 * days). Operations suspend them (their live and waiting ads leave the market), bring them back, or lift a Safe pay
 * limit (strikes so far stop counting). Every change is audited.
 */
export default function ClassifiedSellerPage() {
  const { id } = useParams<{ id: string }>();
  const admin = useAdmin();
  const seller = useClassifiedSellerQuery(id);
  const listings = useClassifiedListingsQuery({ customer_id: id });
  const [suspend] = useSetClassifiedSellerSuspendedMutation();
  const [clear] = useClearClassifiedStrikesMutation();
  const [action, setAction] = useState<Action | null>(null);
  const operations = can(admin, "operations");

  const columns: Array<Column<AdminClassifiedListing>> = [
    { key: "ad", header: "Ad", cell: item => <ListingCell listing={item} /> },
    { key: "price", header: "Price", hideOnMobile: true, cell: item => listingPrice(item.price) },
    { key: "status", header: "Status", cell: item => <ListingStatus status={item.status} /> },
    { key: "updated", header: "Updated", hideOnMobile: true, cell: item => <span className="text-xs text-muted">{formatDateTime(item.updated_at)}</span> },
  ];

  return (
    <AdminShell
      section="classifieds"
      current="/classifieds/sellers"
      crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Users", href: "/classifieds/sellers" }, { label: seller.data?.name ?? "Seller" }]}
    >
      <QueryView query={seller} loading={<Skeleton className="h-96 w-full" />}>
        {data => (
          <>
            <PageHeader
              title={data.name}
              description={`${data.email} · ${data.country ?? "no country"} · member since ${formatDateTime(data.member_since)}`}
              actions={
                operations ? (
                  <span className="flex flex-wrap gap-2">
                    {data.safe_pay.limited ? (
                      <Button variant="secondary" onClick={() => setAction("clear")}>
                        Lift the Safe pay limit
                      </Button>
                    ) : null}
                    {data.suspended ? (
                      <Button variant="secondary" onClick={() => setAction("unsuspend")}>
                        Unsuspend
                      </Button>
                    ) : (
                      <Button variant="danger" onClick={() => setAction("suspend")}>
                        Suspend
                      </Button>
                    )}
                  </span>
                ) : null
              }
            />
            {data.suspended ? (
              <div className="mt-4">
                <Notice tone="red" title={`Suspended ${formatDateTime(data.suspended_at)}`}>
                  {data.suspended_reason ?? "No reason recorded."} They cannot post, and their ads are off the market.
                </Notice>
              </div>
            ) : null}
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Live ads" value={formatNumber(data.listings.active)} icon={<Package className="size-5" />} footer={`${formatNumber(data.listings.total)} in all, ${formatNumber(data.listings.sold)} sold`} />
              <StatCard label="Open reports" value={formatNumber(data.open_reports)} icon={<Flag className="size-5" />} tone={data.open_reports ? "amber" : "blue"} />
              <StatCard label="Safe pay sales" value={formatNumber(data.safe_pay_sales)} icon={<HandCoins className="size-5" />} footer={`${formatNumber(data.safe_pay.bought)} bought`} />
              <StatCard label="Safe pay strikes" value={`${data.safe_pay.strikes} of ${data.safe_pay.strike_limit ?? "—"}`} icon={<Ban className="size-5" />} tone={data.safe_pay.limited ? "amber" : "violet"} footer={data.safe_pay.limited ? "Cannot take Safe pay orders" : "In the last 90 days"} />
            </div>
            <div className="mt-6 grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader
                  title="Ads"
                  actions={
                    <AppLink href={`/classifieds/listings?customer=${data.id}`} className="text-sm font-semibold text-brand-600 hover:underline">
                      See all
                    </AppLink>
                  }
                />
                <DataTable columns={columns} rows={listings.data?.data.slice(0, 20)} rowKey={item => item.id} loading={listings.isLoading} error={listings.error ? errorMessage(listings.error) : null} onRetry={listings.refetch} empty="No ads yet." />
              </Card>
              <div className="space-y-6">
                <Standing seller={data} />
                <Reports seller={data} />
                <Card>
                  <CardHeader title="Account" />
                  <div className="px-5 pb-5 text-sm sm:px-6">
                    <p className="text-muted">{data.phone_confirmed ? "Phone confirmed." : "No confirmed phone."}</p>
                    <AppLink href={`/storefront/customers/${data.id}`} className="mt-2 inline-block font-semibold text-brand-600 hover:underline">
                      Open their bitocard.com account
                    </AppLink>
                  </div>
                </Card>
              </div>
            </div>
            {action ? (
              <ActionDialog
                open
                onClose={() => setAction(null)}
                title={{ suspend: `Suspend ${data.name}?`, unsuspend: `Unsuspend ${data.name}?`, clear: "Lift the Safe pay limit?" }[action]}
                description={
                  {
                    suspend: "They cannot post, and their live and waiting ads are removed from BitoCard Shop. Ads removed now stay removed when they come back.",
                    unsuspend: "They can post again. Ads removed while suspended stay removed.",
                    clear: "They can take Safe pay orders again. Strikes before now stop counting; new ones count from today.",
                  }[action]
                }
                confirmLabel={{ suspend: "Suspend", unsuspend: "Unsuspend", clear: "Lift the limit" }[action]}
                tone={action === "suspend" ? "danger" : "primary"}
                onConfirm={reason => (action === "clear" ? clear({ id, reason }).unwrap() : suspend({ id, suspended: action === "suspend", reason }).unwrap())}
              />
            ) : null}
          </>
        )}
      </QueryView>
    </AdminShell>
  );
}

function Standing({ seller }: { seller: ClassifiedSellerDetail }) {
  const standing = seller.safe_pay;
  return (
    <Card>
      <CardHeader title="Safe pay standing" description="Strikes over the last 90 days, since the limit was last lifted." />
      <div className="space-y-3 px-5 pb-5 sm:px-6">
        {standing.limited ? <Badge tone="red">Limited: cannot take Safe pay orders</Badge> : <Badge tone="green">Can take Safe pay orders</Badge>}
        <KeyValue
          items={[
            { label: "Cancelled after accepting", value: formatNumber(standing.cancelled_after_accepting) },
            { label: "Not handed over in time", value: formatNumber(standing.not_handed_over) },
            { label: "Disputes lost", value: formatNumber(standing.disputes_lost) },
            { label: "Limit", value: standing.strike_limit === null ? "—" : `${standing.strike_limit} strikes` },
            { label: "Last lifted", value: formatDateTime(standing.cleared_at) },
          ]}
        />
      </div>
    </Card>
  );
}

function Reports({ seller }: { seller: ClassifiedSellerDetail }) {
  return (
    <Card>
      <CardHeader title="Reports" description="About them or their ads, newest first." />
      <div className="px-5 pb-5 text-sm sm:px-6">
        {seller.reports.length ? (
          <ul className="space-y-3">
            {seller.reports.map(report => (
              <li key={report.id}>
                <span className="font-semibold">{reportReasonLabels[report.reason] ?? report.reason}</span> <Badge tone={report.status === "open" ? "amber" : "grey"}>{report.status}</Badge>
                {report.details ? <span className="block text-ink">{report.details}</span> : null}
                <span className="block text-xs text-muted">
                  {report.listing ? (
                    <AppLink href={`/classifieds/listings/${report.listing.id}`} className="text-brand-600 hover:underline">
                      #{report.listing.ref} {report.listing.title}
                    </AppLink>
                  ) : report.conversation_id ? (
                    <AppLink href={`/classifieds/conversations/${report.conversation_id}`} className="text-brand-600 hover:underline">
                      From a chat
                    </AppLink>
                  ) : null}{" "}
                  · {formatDateTime(report.created_at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">No reports.</p>
        )}
      </div>
    </Card>
  );
}
