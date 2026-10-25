"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, Card, DataTable, errorMessage, FilterSelect, formatDateTime, formatNumber, Input, PageHeader, useDebouncedValue, type Column } from "@bitocard/admin-ui";
import { AdminShell } from "@bitocard/admin-ui/shell";
import { type AdminClassifiedListing, type ClassifiedListingStatus, classifiedListingStatuses, useClassifiedListingsQuery } from "@bitocard/api-client/admin";
import { ListingCell, ListingStatus, listingPrice, listingStatusLabels, MarketFilter, PersonCell } from "@/components/classifieds";

const pageSize = 50;

/** BitoCard Shop > Listings: every ad in every state, searched by title, number or the seller's email. */
export default function ClassifiedListingsPage() {
  // A seller's page links here with ?customer=<id>.
  return (
    <Suspense>
      <Listings />
    </Suspense>
  );
}

function Listings() {
  const customer = useSearchParams().get("customer") ?? undefined;
  const [status, setStatus] = useState<ClassifiedListingStatus | "">("");
  const [country, setCountry] = useState("");
  const [words, setWords] = useState("");
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(words.trim());
  const listings = useClassifiedListingsQuery({ status: status || undefined, country: country || undefined, customer_id: customer, q: q || undefined, offset });
  const total = listings.data?.total ?? 0;

  const columns: Array<Column<AdminClassifiedListing>> = [
    { key: "listing", header: "Ad", cell: item => <ListingCell listing={item} /> },
    { key: "seller", header: "Seller", hideOnMobile: true, cell: item => <PersonCell person={item.seller} /> },
    { key: "price", header: "Price", cell: item => <span className="whitespace-nowrap">{listingPrice(item.price)}</span> },
    { key: "status", header: "Status", cell: item => <ListingStatus status={item.status} /> },
    { key: "views", header: "Views · leads", hideOnMobile: true, align: "right", cell: item => `${formatNumber(item.views)} · ${formatNumber(item.leads)}` },
    { key: "updated", header: "Updated", hideOnMobile: true, cell: item => <span className="text-xs text-muted">{formatDateTime(item.updated_at)}</span> },
  ];

  return (
    <AdminShell section="classifieds" current="/classifieds/listings" crumbs={[{ label: "BitoCard Shop", href: "/classifieds" }, { label: "Listings" }]}>
      <PageHeader title="Listings" description={customer ? "One seller's ads." : "Every ad on BitoCard Shop, drafts included. Search by title, ad number or the seller's email."} />
      <div className="mt-6 flex flex-wrap items-end gap-3">
        <FilterSelect
          id="listings-status"
          label="Status"
          value={status}
          onChange={value => {
            setStatus(value as ClassifiedListingStatus | "");
            setOffset(0);
          }}
          options={[{ value: "", label: "All" }, ...classifiedListingStatuses.map(value => ({ value, label: listingStatusLabels[value] }))]}
        />
        <MarketFilter
          id="listings-market"
          value={country}
          onChange={value => {
            setCountry(value);
            setOffset(0);
          }}
        />
        <label className="min-w-56 flex-1 sm:max-w-sm">
          <span className="sr-only">Search ads</span>
          <Input
            type="search"
            placeholder="Title, number or email"
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
          rows={listings.data?.data}
          rowKey={item => item.id}
          loading={listings.isLoading}
          error={listings.error ? errorMessage(listings.error) : null}
          onRetry={listings.refetch}
          empty="No ads match."
        />
      </Card>
      {total > pageSize ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-sm text-muted">
          <span>
            {offset + 1} to {Math.min(offset + pageSize, total)} of {formatNumber(total)}
          </span>
          <span className="flex gap-2">
            <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
              Newer
            </Button>
            <Button size="sm" variant="ghost" disabled={offset + pageSize >= total} onClick={() => setOffset(offset + pageSize)}>
              Older
            </Button>
          </span>
        </div>
      ) : null}
    </AdminShell>
  );
}
