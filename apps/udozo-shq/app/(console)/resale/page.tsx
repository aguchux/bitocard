"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, Store } from "lucide-react";
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, Notice, PageHeader, QueryView, Select, Skeleton, errorMessage, formatBps, formatMoney, useDebouncedValue } from "@bitocard/admin-ui";
import { type ResaleCatalogueListing, useAddResaleListingMutation, useResaleAccountQuery, useResaleCatalogueQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { PriceEditor, ResaleGate } from "@/components/resale";

const pageSize = 24;

/**
 * Resale > Browse: Udozo suppliers' resale listings in the reseller's country, each with the supplier's terms,
 * the range they may sell in and what they would keep. Adding one puts it on a Resale shop store at their price.
 */
export default function ResaleBrowsePage() {
  const id = useId();
  const { membership } = useReseller();
  const canAdd = can(membership, "admin");
  const account = useResaleAccountQuery();
  const stores = account.data?.stores ?? [];
  const [picked, setStoreId] = useState("");
  // The first store until another is chosen.
  const storeId = picked || stores[0]?.id || "";
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"newest" | "price_asc" | "price_desc">("newest");
  const [offset, setOffset] = useState(0);
  const words = useDebouncedValue(q.trim());
  const open = Boolean(account.data?.available);
  const catalogue = useResaleCatalogueQuery({ q: words || undefined, sort, offset, limit: pageSize, store_id: storeId || undefined }, { skip: !open });
  const [adding, setAdding] = useState<ResaleCatalogueListing | null>(null);

  return (
    <ShqShell section="resale" current="/resale" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Browse" }]}>
      <PageHeader
        title="Browse resale listings"
        description="Listings Udozo sellers in your country let resellers sell. Your store always shows the supplier’s own words and photos and names them; you set your price inside their limits."
      />
      {account.isLoading ? <Skeleton className="h-24" /> : <ResaleGate account={account.data} />}
      {open ? (
        <>
          <Card className="p-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <Field label="Search" htmlFor={`${id}-q`}>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                  <Input id={`${id}-q`} className="pl-9" value={q} placeholder="Phones, TVs, generators…" onChange={event => { setQ(event.target.value); setOffset(0); }} />
                </div>
              </Field>
              <Field label="Sort" htmlFor={`${id}-sort`}>
                <Select id={`${id}-sort`} value={sort} onChange={event => { setSort(event.target.value as typeof sort); setOffset(0); }}>
                  <option value="newest">Newest</option>
                  <option value="price_asc">Price: low to high</option>
                  <option value="price_desc">Price: high to low</option>
                </Select>
              </Field>
              {stores.length > 1 ? (
                <Field label="Store" htmlFor={`${id}-store`}>
                  <Select id={`${id}-store`} value={storeId} onChange={event => setStoreId(event.target.value)}>
                    {stores.map(store => (
                      <option key={store.id} value={store.id}>{store.name}</option>
                    ))}
                  </Select>
                </Field>
              ) : null}
            </div>
          </Card>
          <QueryView query={catalogue} loading={<Skeleton className="h-64" />}>
            {data =>
              data.data.length ? (
                <>
                  <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {data.data.map(item => (
                      <li key={item.id}>
                        <CatalogueCard item={item} inStore={item.in_stores.length > 0} canAdd={canAdd && stores.length > 0} onAdd={() => setAdding(item)} />
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between gap-3 text-sm text-muted">
                    <span>
                      {data.offset + 1}–{data.offset + data.data.length} of {data.total}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</Button>
                      <Button variant="secondary" size="sm" disabled={data.offset + data.data.length >= data.total} onClick={() => setOffset(offset + pageSize)}>Next</Button>
                    </div>
                  </div>
                </>
              ) : (
                <EmptyState title="No resale listings found">Suppliers in your country have not opened listings to resellers yet, or none match.</EmptyState>
              )
            }
          </QueryView>
        </>
      ) : null}
      {adding ? <AddDialog item={adding} storeId={storeId} storeName={stores.find(store => store.id === storeId)?.name ?? ""} onClose={() => setAdding(null)} /> : null}
    </ShqShell>
  );
}

function CatalogueCard({ item, inStore, canAdd, onAdd }: { item: ResaleCatalogueListing; inStore: boolean; canAdd: boolean; onAdd: () => void }) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <Link href={`/resale/catalogue/${item.id}`} className="block aspect-[4/3] bg-canvas">
        {item.cover ? (
          // eslint-disable-next-line @next/next/no-img-element -- supplier photos from Udozo's storage
          <img src={item.cover.url} alt="" className="size-full object-cover" />
        ) : null}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Link href={`/resale/catalogue/${item.id}`} className="font-semibold text-ink hover:underline">{item.title}</Link>
        <p className="text-sm text-muted">
          Supplied by {item.supplier.name}
          {item.supplier.badges.includes("id_checked") ? " · ID checked" : ""}
          {item.area ? ` · ${item.area.name}` : ""}
        </p>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="blue" dot={false}>{formatBps(item.discount_bps)} discount</Badge>
          <Badge tone="grey" dot={false}>up to +{formatBps(item.markup_max_bps)}</Badge>
          {item.deal_id ? <Badge tone="pink" dot={false}>Your deal</Badge> : null}
          {item.available <= 0 ? <Badge tone="amber" dot={false}>None left</Badge> : <Badge tone="grey" dot={false}>{item.available} left</Badge>}
        </div>
        <p className="text-sm">
          Sell from <strong>{formatMoney(item.price_range.min, item.currency)}</strong> to <strong>{formatMoney(item.price_range.max, item.currency)}</strong>
        </p>
        {item.earnings_at_max !== null ? <p className="text-sm text-muted">Keep up to {formatMoney(item.earnings_at_max, item.currency)} a sale</p> : null}
        <div className="mt-auto pt-2">
          {inStore ? (
            <Badge tone="green">In your store</Badge>
          ) : canAdd ? (
            <Button size="sm" icon={<Store className="size-4" aria-hidden />} onClick={onAdd}>Add to store</Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function AddDialog({ item, storeId, storeName, onClose }: { item: ResaleCatalogueListing; storeId: string; storeName: string; onClose: () => void }) {
  const router = useRouter();
  const [add, state] = useAddResaleListingMutation();
  return (
    <Dialog open onClose={onClose} title={`Add to ${storeName}`} description={item.title}>
      <PriceEditor
        listingId={item.id}
        currency={item.currency}
        supplierPrice={item.supplier_price}
        discountBps={item.discount_bps}
        floorBps={item.floor_bps}
        markupMaxBps={item.markup_max_bps}
        submitLabel="Add to store"
        busy={state.isLoading}
        error={state.error ? errorMessage(state.error) : null}
        onSubmit={async choice => {
          const result = await add({ store_id: storeId, listing_id: item.id, ...choice });
          if ("data" in result && result.data) router.push(`/resale/listings/${result.data.id}`);
        }}
      />
      {item.available <= 0 ? <Notice tone="amber">None are left right now; it shows as sold out until the supplier has more.</Notice> : null}
    </Dialog>
  );
}
