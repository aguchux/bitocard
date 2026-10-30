"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { MessagesSquare, Store } from "lucide-react";
import { Badge, Button, Card, CardHeader, Dialog, KeyValue, PageHeader, QueryView, Skeleton, errorMessage, formatBps, formatMoney, humanise } from "@bitocard/admin-ui";
import { useAddResaleListingMutation, useResaleAccountQuery, useResaleCatalogueListingQuery, useStartResaleSupplierMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { PriceEditor } from "@/components/resale";

/** One resale listing exactly as its supplier wrote it, with its terms for this reseller. */
export default function ResaleCatalogueListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { membership } = useReseller();
  const query = useResaleCatalogueListingQuery(id);
  const account = useResaleAccountQuery();
  const [adding, setAdding] = useState<string | null>(null);
  const [add, addState] = useAddResaleListingMutation();
  const [start, startState] = useStartResaleSupplierMutation();
  const stores = account.data?.stores ?? [];

  return (
    <ShqShell section="resale" current="/resale" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Browse", href: "/resale" }, { label: query.data?.title ?? "Listing" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96" />}>
        {item => (
          <>
            <PageHeader
              title={item.title}
              description={`Supplied by ${item.supplier.name}. Your store shows exactly this, with the supplier’s name.`}
              actions={
                <div className="flex flex-wrap gap-2">
                  {can(membership, "admin", "support") ? (
                    <Button
                      variant="secondary"
                      icon={<MessagesSquare className="size-4" aria-hidden />}
                      loading={startState.isLoading}
                      onClick={async () => {
                        const result = await start(item.supplier.id);
                        if ("data" in result && result.data) router.push(`/resale/suppliers/${result.data.id}`);
                      }}
                    >
                      Message the supplier
                    </Button>
                  ) : null}
                  {can(membership, "admin")
                    ? stores
                        .filter(store => !item.in_stores.some(row => row.store_id === store.id))
                        .map(store => (
                          <Button key={store.id} icon={<Store className="size-4" aria-hidden />} onClick={() => setAdding(store.id)}>
                            Add to {store.name}
                          </Button>
                        ))
                    : null}
                </div>
              }
            />
            {startState.error ? <p className="text-sm text-red-600">{errorMessage(startState.error)}</p> : null}
            <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
              <Card className="space-y-4 p-5">
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {item.photos.map(photo => (
                    <li key={photo.url} className="aspect-square overflow-hidden rounded-xl bg-canvas">
                      {/* eslint-disable-next-line @next/next/no-img-element -- supplier photos */}
                      <img src={photo.url} alt="" className="size-full object-cover" />
                    </li>
                  ))}
                </ul>
                {item.description ? <p className="whitespace-pre-line text-sm text-ink">{item.description}</p> : null}
                {item.features.length ? (
                  <KeyValue items={item.features.map(feature => ({ label: feature.name, value: `${String(feature.value)}${feature.unit ? ` ${feature.unit}` : ""}` }))} />
                ) : null}
              </Card>
              <Card>
                <CardHeader title="Your terms" />
                <div className="space-y-3 p-5 text-sm">
                  <KeyValue
                    items={[
                      { label: "Supplier’s price", value: formatMoney(item.supplier_price, item.currency) },
                      { label: "Your discount", value: formatBps(item.discount_bps) },
                      { label: "Sell from", value: formatMoney(item.price_range.min, item.currency) },
                      { label: "Sell up to", value: formatMoney(item.price_range.max, item.currency) },
                      { label: "Left", value: String(item.available) },
                      { label: "Condition", value: item.condition ? humanise(item.condition) : "—" },
                      { label: "Delivery", value: item.delivery === "none" ? "Meet-up in their area" : item.delivery === "state" ? "Within their state" : "Nationwide" },
                    ]}
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {item.supplier.badges.map(badge => (
                      <Badge key={badge} tone="green">{badge === "id_checked" ? "ID checked" : "Phone confirmed"}</Badge>
                    ))}
                    {item.deal_id ? <Badge tone="pink">Your deal applies</Badge> : null}
                  </div>
                </div>
              </Card>
            </div>
            {adding ? (
              <Dialog open onClose={() => setAdding(null)} title={`Add to ${stores.find(store => store.id === adding)?.name ?? "your store"}`} description={item.title}>
                <PriceEditor
                  listingId={item.id}
                  currency={item.currency}
                  supplierPrice={item.supplier_price}
                  discountBps={item.discount_bps}
                  floorBps={item.floor_bps}
                  markupMaxBps={item.markup_max_bps}
                  submitLabel="Add to store"
                  busy={addState.isLoading}
                  error={addState.error ? errorMessage(addState.error) : null}
                  onSubmit={async choice => {
                    const result = await add({ store_id: adding, listing_id: item.id, ...choice });
                    if ("data" in result && result.data) router.push(`/resale/listings/${result.data.id}`);
                  }}
                />
              </Dialog>
            ) : null}
          </>
        )}
      </QueryView>
    </ShqShell>
  );
}
