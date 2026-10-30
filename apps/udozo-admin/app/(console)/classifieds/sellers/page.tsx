"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, DataTable, errorMessage, formatDate, formatNumber, Input, PageHeader, Tabs, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { UdozoShell } from "@/components/shell";
import { type ClassifiedSeller, useClassifiedSellersQuery } from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";

const pageSize = 50;

/** Udozo > Sellers: customers who have put up an ad, with what they list, reports about them and suspensions. */
export default function ClassifiedSellersPage() {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | "suspended">("all");
  const [country, setCountry] = useState("");
  const [words, setWords] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(words.trim());
  const sellers = useClassifiedSellersQuery({ status, country: country || undefined, q: q || undefined, offset });
  const total = sellers.data?.total ?? 0;

  const columns: Array<Column<ClassifiedSeller>> = [
    {
      key: "seller",
      header: "Seller",
      cell: item => (
        <span className="block min-w-0">
          <span className="block truncate font-semibold text-ink">{item.name}</span>
          <span className="block truncate text-xs text-muted">{item.email}</span>
        </span>
      ),
    },
    { key: "country", header: "Market", hideOnMobile: true, cell: item => item.country ?? "—" },
    {
      key: "listings",
      header: "Ads",
      cell: item => (
        <span className="block text-sm">
          {formatNumber(item.listings.active)} live
          <span className="block text-xs text-muted">
            {formatNumber(item.listings.total)} in all · {formatNumber(item.listings.sold)} sold
            {item.listings.pending_review ? ` · ${item.listings.pending_review} in review` : ""}
          </span>
        </span>
      ),
    },
    { key: "sales", header: "Safe pay sales", hideOnMobile: true, align: "right", cell: item => formatNumber(item.safe_pay_sales) },
    {
      key: "flags",
      header: "Standing",
      cell: item => (
        <span className="flex flex-wrap gap-1.5">
          {item.suspended ? <Badge tone="red">Suspended</Badge> : <Badge tone="green">Active</Badge>}
          {item.open_reports ? <Badge tone="amber">{item.open_reports} open reports</Badge> : null}
        </span>
      ),
    },
    { key: "since", header: "Member since", hideOnMobile: true, cell: item => <span className="text-xs text-muted">{formatDate(item.member_since)}</span> },
  ];

  return (
    <UdozoShell section="marketplace" current="/classifieds/sellers" crumbs={[{ label: "Marketplace", href: "/classifieds" }, { label: "Users" }]}>
      <PageHeader title="Users" description="Udozo accounts that have put up an ad on Udozo. Open one to see their ads, the reports about them and their Safe pay strikes, or to suspend them." />
      <div className="mt-6">
        <Tabs
          label="Sellers shown"
          value={status}
          onChange={value => {
            setStatus(value);
            setOffset(0);
          }}
          items={[
            { value: "all", label: "All sellers" },
            { value: "suspended", label: "Suspended" },
          ]}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <MarketFilter
          id="sellers-market"
          value={country}
          onChange={value => {
            setCountry(value);
            setOffset(0);
          }}
        />
        <label className="min-w-56 flex-1 sm:max-w-sm">
          <span className="sr-only">Search sellers</span>
          <Input
            type="search"
            placeholder="Name or email"
            value={words}
            onChange={event => {
              setWords(event.target.value);
              setOffset(0);
            }}
          />
        </label>
      </div>
      <Card className="mt-4">
        <DataTable
          columns={columns}
          rows={sellers.data?.data}
          rowKey={item => item.id}
          loading={sellers.isLoading}
          error={sellers.error ? errorMessage(sellers.error) : null}
          onRetry={sellers.refetch}
          onRowClick={item => router.push(`/classifieds/sellers/${item.id}`)}
          empty="No sellers match."
        />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Previous
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </UdozoShell>
  );
}
