"use client";

import { useId, useState } from "react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, FilterSelect, formatDate, Input, PageHeader, type Column } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import {
  type ConnectAuction,
  type ConnectAuctionEligible,
  useCancelConnectAuctionMutation,
  useConnectAuctionEligibleQuery,
  useConnectAuctionsQuery,
  useCreateConnectAuctionMutation,
  useHandOverConnectAuctionMutation,
} from "@bitocard/api-client/admin";
import { MarketFilter } from "@/components/classifieds";
import { isoFromLocal, money, toMinor } from "@/components/connect";
import { UdozoShell } from "@/components/shell";
import { udozoOrigin } from "@/components/theme";

const auctionStatusLabels: Record<ConnectAuction["status"], string> = {
  scheduled: "Opens soon",
  live: "Bidding",
  awaiting_payment: "Waiting for payment",
  sold: "Sold",
  unsold: "Not sold",
  cancelled: "Cancelled",
};
const bidStatusLabels: Record<ConnectAuction["bids"][number]["status"], string> = { active: "Bid", offered: "Offered the lot", lapsed: "Did not pay", won: "Won" };
const statusTones: Record<ConnectAuction["status"], "blue" | "amber" | "green" | "grey" | "red"> = { scheduled: "blue", live: "amber", awaiting_payment: "amber", sold: "green", unsold: "grey", cancelled: "grey" };

/** A day ahead at least, as the browser's datetime-local field wants it: listings are told to sellers first. */
const localIn = (hours: number) => {
  const at = new Date(Date.now() + hours * 3_600_000);
  at.setMinutes(at.getMinutes() - at.getTimezoneOffset());
  return at.toISOString().slice(0, 16);
};

type Listing = { item: ConnectAuctionEligible; start: string; costs: string; startsAt: string; endsAt: string; belowOwed: boolean; problem: string | null };

/**
 * Connect > Auctions: abandoned items at Udozo's warehouses that can be auctioned (months into Loss of care), listing
 * one (a starting price of at least what its seller owes, opening a day later), the lots and their bids, cancelling one
 * nobody has bid on, and handing a sold one to its buyer against their collection code. Operations act; others read.
 */
export default function ConnectAuctionsPage() {
  const id = useId();
  const admin = useAdmin();
  const operations = can(admin, "operations");
  const [country, setCountry] = useState("");
  const [status, setStatus] = useState<ConnectAuction["status"] | "">("");
  const eligible = useConnectAuctionEligibleQuery({ country: country || undefined });
  const lots = useConnectAuctionsQuery({ country: country || undefined, status: status || undefined });
  const [create] = useCreateConnectAuctionMutation();
  const [cancel] = useCancelConnectAuctionMutation();
  const [handOver] = useHandOverConnectAuctionMutation();
  const [listing, setListing] = useState<Listing | null>(null);
  const [cancelling, setCancelling] = useState<ConnectAuction | null>(null);
  const [handing, setHanding] = useState<{ lot: ConnectAuction; code: string } | null>(null);
  const [open, setOpen] = useState<ConnectAuction | null>(null);

  const eligibleColumns: Array<Column<ConnectAuctionEligible>> = [
    {
      key: "item",
      header: "Item",
      cell: row => (
        <AppLink href={`/classifieds/orders/${row.order_id}`} className="block min-w-0 hover:underline">
          <span className="block truncate font-semibold text-ink">{row.title ?? "An item"}</span>
          <span className="block text-xs text-muted">
            {row.number} · sold for {money(row.price, row.currency)}
          </span>
        </AppLink>
      ),
    },
    { key: "owed", header: "Its seller owes", cell: row => <span className="text-sm">{money(row.owed, row.currency)}</span> },
    { key: "where", header: "Where", hideOnMobile: true, cell: row => <span className="text-sm">{row.warehouse?.name ?? "—"}</span> },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        row.due ? (
          operations ? (
            <Button size="sm" onClick={() => setListing({ item: row, start: String(row.owed / 100), costs: "", startsAt: localIn(25), endsAt: localIn(25 + 72), belowOwed: false, problem: null })}>
              List at auction
            </Button>
          ) : null
        ) : (
          <span className="text-xs text-muted">From {formatDate(row.auction_from)}</span>
        ),
    },
  ];

  const lotColumns: Array<Column<ConnectAuction>> = [
    {
      key: "lot",
      header: "Lot",
      cell: row => (
        <button type="button" onClick={() => setOpen(row)} className="block min-w-0 text-left hover:underline">
          <span className="block truncate font-semibold text-ink">{row.title}</span>
          <span className="block text-xs text-muted">
            {row.number} · {row.order.number} · {row.warehouse.name}
          </span>
        </button>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: row => (
        <span className="grid gap-1">
          <Badge tone={statusTones[row.status]}>{auctionStatusLabels[row.status]}</Badge>
          <span className="text-xs text-muted">{row.status === "scheduled" ? `Opens ${formatDate(row.starts_at)}` : `Ends ${formatDate(row.ends_at)}`}</span>
        </span>
      ),
    },
    {
      key: "price",
      header: "Price",
      cell: row => (
        <span className="text-sm">
          {row.sale !== null ? `Sold for ${money(row.sale, row.currency)}` : row.current_price !== null ? `${money(row.current_price, row.currency)} · ${row.bids.length} bids` : `From ${money(row.start_price, row.currency)}`}
        </span>
      ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      cell: row =>
        !operations ? null : row.status === "sold" && !row.collected_at ? (
          <Button size="sm" onClick={() => setHanding({ lot: row, code: "" })}>
            Hand over
          </Button>
        ) : (row.status === "scheduled" || row.status === "live") && !row.bids.length ? (
          <Button size="sm" variant="secondary" onClick={() => setCancelling(row)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  const submitListing = async () => {
    if (!listing) return;
    const currency = listing.item.currency;
    const start = toMinor(listing.start, currency);
    const costs = listing.costs.trim() ? toMinor(listing.costs, currency) : 0;
    const startsAt = isoFromLocal(listing.startsAt);
    const endsAt = isoFromLocal(listing.endsAt);
    if (!start || costs === null || !startsAt || !endsAt) {
      setListing({ ...listing, problem: "Give the starting price, any costs, and when bidding opens and closes." });
      throw new Error("Give the starting price, any costs, and when bidding opens and closes.");
    }
    await create({ order_id: listing.item.order_id, start_price: start, costs, starts_at: startsAt, ends_at: endsAt, ...(listing.belowOwed ? { below_owed: true } : {}) }).unwrap();
  };

  return (
    <UdozoShell section="connect" current="/connect/auctions" crumbs={[{ label: "Connect", href: "/connect/applications" }, { label: "Auctions" }]}>
      <PageHeader title="Auctions" description="Abandoned items at Udozo's warehouses, sold on udozo.com as auction listings of Udozo's own to recover the storage their sellers owe. Sellers' own auctions are ordinary listings (Marketplace > Listings)." />
      <div className="mt-6">
        <MarketFilter id="auctions-market" value={country} onChange={setCountry} />
      </div>
      <Card className="mt-4">
        <CardHeader title="Can be auctioned" description="Items at a warehouse, by how long they have been in Loss of care. Their seller is told when one is listed, and can still collect it until the first bid." />
        <DataTable<ConnectAuctionEligible> caption="Items that can be auctioned" columns={eligibleColumns} rows={eligible.data?.data} loading={eligible.isLoading} error={eligible.error ? errorMessage(eligible.error) : null} onRetry={eligible.refetch} rowKey={row => row.order_id} empty="Nothing to auction." />
      </Card>
      <Card className="mt-4">
        <CardHeader
          title="Lots"
          description="Choose a lot to see its bids and what the sale paid."
          actions={
            <FilterSelect
              id="auctions-status"
              label="Status"
              value={status}
              onChange={value => setStatus(value as ConnectAuction["status"] | "")}
              options={[{ value: "", label: "All" }, ...(Object.keys(auctionStatusLabels) as Array<ConnectAuction["status"]>).map(value => ({ value, label: auctionStatusLabels[value] }))]}
            />
          }
        />
        <DataTable<ConnectAuction> caption="Lots" columns={lotColumns} rows={lots.data?.data} loading={lots.isLoading} error={lots.error ? errorMessage(lots.error) : null} onRetry={lots.refetch} rowKey={row => row.id} empty="No lots yet." />
      </Card>

      {listing ? (
        <ActionDialog
          open
          onClose={() => setListing(null)}
          title={`Auction "${listing.item.title ?? listing.item.number}"`}
          description={`Its seller owes ${money(listing.item.owed, listing.item.currency)}. Start at least there, plus any costs, unless you say it may start below. Bidding opens at least a day after listing.`}
          confirmLabel="List at auction"
          requireReason={false}
          onConfirm={submitListing}
        >
          <div className="grid gap-3">
            <Field label={`Starting price (${listing.item.currency})`} htmlFor={`${id}-start`}>
              <Input id={`${id}-start`} inputMode="decimal" value={listing.start} onChange={event => setListing({ ...listing, start: event.target.value, problem: null })} />
            </Field>
            <Field label={`Costs of selling and moving it (${listing.item.currency})`} htmlFor={`${id}-costs`} hint="Paid from the sale before what is left over. Never the pickup.">
              <Input id={`${id}-costs`} inputMode="decimal" value={listing.costs} onChange={event => setListing({ ...listing, costs: event.target.value, problem: null })} />
            </Field>
            <Field label="Bidding opens" htmlFor={`${id}-starts`}>
              <Input id={`${id}-starts`} type="datetime-local" value={listing.startsAt} onChange={event => setListing({ ...listing, startsAt: event.target.value, problem: null })} />
            </Field>
            <Field label="Bidding closes" htmlFor={`${id}-ends`}>
              <Input id={`${id}-ends`} type="datetime-local" value={listing.endsAt} onChange={event => setListing({ ...listing, endsAt: event.target.value, problem: null })} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={listing.belowOwed} onChange={() => setListing({ ...listing, belowOwed: !listing.belowOwed })} />
              It may start below what is owed
            </label>
            {listing.problem ? (
              <p className="text-sm text-red-700" role="alert">
                {listing.problem}
              </p>
            ) : null}
          </div>
        </ActionDialog>
      ) : null}
      {cancelling ? (
        <ActionDialog open onClose={() => setCancelling(null)} title={`Cancel ${cancelling.number}?`} description="Nobody has bid. The item stays at the warehouse." confirmLabel="Cancel lot" tone="danger" onConfirm={async reason => void (await cancel({ id: cancelling.id, reason }).unwrap())} />
      ) : null}
      {handing ? (
        <ActionDialog
          open
          onClose={() => setHanding(null)}
          title={`Hand ${handing.lot.number} to its buyer`}
          description="The buyer gives their collection code once the item is in their hands."
          confirmLabel="Hand over"
          requireReason={false}
          onConfirm={async () => void (await handOver({ id: handing.lot.id, code: handing.code }).unwrap())}
        >
          <Field label="Buyer's collection code" htmlFor={`${id}-code`}>
            <Input id={`${id}-code`} inputMode="numeric" value={handing.code} onChange={event => setHanding({ ...handing, code: event.target.value })} />
          </Field>
        </ActionDialog>
      ) : null}
      {open ? (
        <Dialog open onClose={() => setOpen(null)} title={`${open.number}: ${open.title}`}>
          <p className="mb-3 text-sm text-muted">
            {auctionStatusLabels[open.status]}
            {open.listing ? (
              <>
                {" · "}
                <a href={`${udozoOrigin()}/${open.country.toLowerCase()}/l/${open.listing.ref}-${open.listing.slug}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">
                  Open its listing on udozo.com
                </a>
              </>
            ) : null}
          </p>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Starting price</dt>
            <dd>{money(open.start_price, open.currency)}</dd>
            <dt className="text-muted">Its seller owed</dt>
            <dd>{money(open.owed, open.currency)}</dd>
            <dt className="text-muted">Costs</dt>
            <dd>{money(open.costs, open.currency)}</dd>
            <dt className="text-muted">Sold for</dt>
            <dd>{money(open.sale, open.currency)}</dd>
            <dt className="text-muted">Left over for the seller</dt>
            <dd>{money(open.left_over, open.currency)}</dd>
            {open.pay_by && open.status === "awaiting_payment" ? (
              <>
                <dt className="text-muted">To pay by</dt>
                <dd>{formatDate(open.pay_by)}</dd>
              </>
            ) : null}
            {open.collected_at ? (
              <>
                <dt className="text-muted">Collected</dt>
                <dd>{formatDate(open.collected_at)}</dd>
              </>
            ) : null}
            {open.cancel_reason ? (
              <>
                <dt className="text-muted">Cancelled</dt>
                <dd>{open.cancel_reason}</dd>
              </>
            ) : null}
          </dl>
          <h3 className="mt-3 text-sm font-semibold text-ink">Bids</h3>
          {open.bids.length ? (
            <ul className="mt-1 grid gap-1 text-sm">
              {open.bids.map(bid => (
                <li key={bid.id} className="flex justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {bid.bidder.name} <span className="text-muted">{bid.bidder.email}</span>
                  </span>
                  <span>
                    {money(bid.amount, open.currency)} · {bidStatusLabels[bid.status]}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-muted">No bids.</p>
          )}
        </Dialog>
      ) : null}
    </UdozoShell>
  );
}
