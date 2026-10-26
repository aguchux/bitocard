"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ActionDialog, Button, Card, CardHeader, KeyValue, Notice, PageHeader, QueryView, Skeleton, errorMessage, formatBps, formatDateTime, formatMoney } from "@bitocard/admin-ui";
import { resaleStateText, useRemoveResaleListingMutation, useResaleListingQuery, useUpdateResaleListingMutation } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { NoteEditor, PriceEditor, PriceSummary, ResaleStateBadge } from "@/components/resale";

const why: Partial<Record<string, string>> = {
  supplier_stopped: "The supplier stopped you reselling their listings. Talk to them in Suppliers.",
  unavailable: "The supplier no longer offers this listing to resellers (sold, expired or closed).",
  supplier_paused: "The supplier paused reselling it. It sells again when they resume.",
  sold_out: "None are left. It sells again if the supplier adds more.",
  price_out_of_range: "The supplier’s price or your deal changed, so your price is outside their limits. Reprice it below to sell it again.",
};

/** One resale listing on a store: why it is (not) selling, its price and earnings, the note, pause and remove. */
export default function ResaleListingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { membership } = useReseller();
  const canEdit = can(membership, "admin");
  const query = useResaleListingQuery(id);
  const [update, updating] = useUpdateResaleListingMutation();
  const [remove] = useRemoveResaleListingMutation();
  const [repricing, setRepricing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  return (
    <ShqShell section="resale" current="/resale/listings" crumbs={[{ label: "Resale", href: "/resale" }, { label: "Your listings", href: "/resale/listings" }, { label: query.data?.title ?? "Listing" }]}>
      <QueryView query={query} loading={<Skeleton className="h-96" />}>
        {listing => (
          <>
            <PageHeader
              title={listing.title}
              description={<>Supplied by <Link className="font-semibold text-brand-600 hover:underline" href={`/resale/suppliers/${listing.supplier_relationship_id}`}>{listing.supplier.name}</Link>. Your store shows the supplier’s own listing and names them.</>}
              actions={
                canEdit && listing.status !== "removed" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" loading={updating.isLoading} onClick={() => void update({ id: listing.id, status: listing.status === "paused" ? "active" : "paused" })}>
                      {listing.status === "paused" ? "Put back on sale" : "Pause"}
                    </Button>
                    <Button variant="danger" onClick={() => setConfirmRemove(true)}>Remove from store</Button>
                  </div>
                ) : null
              }
            />
            <div className="flex flex-wrap items-center gap-2">
              <ResaleStateBadge state={listing.state} />
              <span className="text-sm text-muted">{resaleStateText[listing.state]}</span>
            </div>
            {why[listing.state] ? <Notice tone={listing.state === "price_out_of_range" ? "amber" : "grey"}>{why[listing.state]}</Notice> : null}
            {updating.error ? <Notice tone="red">{errorMessage(updating.error)}</Notice> : null}
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader
                  title="Price"
                  description={listing.markup_bps !== null ? `${formatBps(listing.markup_bps)} over the supplier’s price, following it.` : "A fixed price."}
                  actions={canEdit && listing.status !== "removed" && listing.supplier_price !== null ? <Button size="sm" variant="secondary" onClick={() => setRepricing(value => !value)}>{repricing ? "Cancel" : "Reprice"}</Button> : null}
                />
                <div className="p-5">
                  {repricing && listing.supplier_price !== null ? (
                    <PriceEditor
                      listingId={listing.listing_id}
                      currency={listing.currency}
                      supplierPrice={listing.supplier_price}
                      discountBps={listing.discount_bps}
                      floorBps={listing.floor_bps}
                      markupMaxBps={listing.markup_max_bps}
                      initial={{ markup_bps: listing.markup_bps, fixed_price: listing.fixed_price }}
                      submitLabel="Save price"
                      busy={updating.isLoading}
                      error={updating.error ? errorMessage(updating.error) : null}
                      onSubmit={async choice => {
                        const result = await update({ id: listing.id, ...choice });
                        if ("data" in result) setRepricing(false);
                      }}
                    />
                  ) : (
                    <PriceSummary price={listing} />
                  )}
                </div>
              </Card>
              <Card>
                <CardHeader title="Your note" description="One short note on the listing, shown on your store only once the supplier approves this exact text." />
                <div className="p-5">
                  <NoteEditor key={listing.note?.text ?? ""} listing={listing} canEdit={canEdit && listing.status !== "removed"} />
                </div>
              </Card>
            </div>
            <Card>
              <CardHeader title="Details" />
              <div className="p-5">
                <KeyValue
                  items={[
                    { label: "Supplier’s price now", value: listing.supplier_price === null ? "—" : formatMoney(listing.supplier_price, listing.currency) },
                    { label: "Your discount", value: formatBps(listing.discount_bps) },
                    { label: "Deal", value: listing.deal_id ? "Your deal with the supplier applies" : "None" },
                    { label: "Left", value: String(listing.available) },
                    { label: "Added", value: `${formatDateTime(listing.created_at)}${listing.rule_id ? " by a rule" : ""}` },
                  ]}
                />
              </div>
            </Card>
            <ActionDialog
              open={confirmRemove}
              onClose={() => setConfirmRemove(false)}
              title="Remove from your store?"
              description="It comes off the store now. Rules never add it back; you can add it again by hand."
              confirmLabel="Remove"
              tone="danger"
              requireReason={false}
              onConfirm={async () => {
                await remove(listing.id).unwrap();
                router.push("/resale/listings");
              }}
            />
          </>
        )}
      </QueryView>
    </ShqShell>
  );
}
