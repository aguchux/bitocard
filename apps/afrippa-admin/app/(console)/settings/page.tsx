"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, Dialog, errorMessage, Field, formatBps, Input, Notice, PageHeader, QueryView, Select, Skeleton, type Column } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { useCryptoAssetsQuery } from "@bitocard/api-client/admin";
import { type P2pFeeRate, useP2pFeeRatesQuery, useRemoveP2pFeeRateMutation, useSetP2pFeeRateMutation } from "@bitocard/api-client/afrippa-admin";
import { AfrippaShell } from "@/components/shell";

const marketLabel = (market: string | null) => (market === null ? "Every market" : market === "WW" ? "Global (WW)" : market);
const toBps = (percent: string) => Math.round(Number(percent) * 100);
const validBps = (bps: number, max: number) => Number.isInteger(bps) && bps >= 0 && bps <= max;

/** Setting one coin's buyer and seller rate for one market, or every market. */
function RateDialog({ rate, maxBps, onClose }: { rate: P2pFeeRate | "new"; maxBps: number; onClose: () => void }) {
  const assets = useCryptoAssetsQuery();
  const existing = rate === "new" ? null : rate;
  const [asset, setAsset] = useState(existing?.asset ?? "");
  const [market, setMarket] = useState(existing?.market ?? "");
  const [buyer, setBuyer] = useState(existing ? String(existing.buyer_bps / 100) : "");
  const [seller, setSeller] = useState(existing ? String(existing.seller_bps / 100) : "");
  const [save, state] = useSetP2pFeeRateMutation();
  const buyerBps = toBps(buyer);
  const sellerBps = toBps(seller);
  const code = market.trim().toUpperCase();
  const valid = Boolean(asset) && buyer !== "" && seller !== "" && validBps(buyerBps, maxBps) && validBps(sellerBps, maxBps) && (code === "" || /^[A-Z]{2}$/.test(code));
  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? `${existing.asset} in ${marketLabel(existing.market)}` : "New fee rate"}
      description="Both sides pay in the coin: the buyer's fee comes out of what they receive, the seller's is held in escrow with the order. A market's own rate wins over the every-market rate."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            loading={state.isLoading}
            onClick={async () => {
              const saved = await save({ asset, market: code || null, buyer_bps: buyerBps, seller_bps: sellerBps })
                .unwrap()
                .catch(() => null);
              if (saved) onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        {existing ? null : (
          <>
            <Field label="Coin" htmlFor="fee-asset">
              <Select id="fee-asset" value={asset} onChange={event => setAsset(event.target.value)}>
                <option value="">Choose a coin</option>
                {(assets.data?.data ?? []).map(item => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Market" htmlFor="fee-market" hint="A country code (NG, GH…) or WW for the global market. Leave it empty for every market.">
              <Input id="fee-market" maxLength={2} value={market} onChange={event => setMarket(event.target.value)} />
            </Field>
          </>
        )}
        <Field label="Buyer's fee (%)" htmlFor="fee-buyer" hint={`0 to ${maxBps / 100}%.`}>
          <Input id="fee-buyer" inputMode="decimal" value={buyer} onChange={event => setBuyer(event.target.value)} />
        </Field>
        <Field label="Seller's fee (%)" htmlFor="fee-seller" hint="Usually more than the buyer's.">
          <Input id="fee-seller" inputMode="decimal" value={seller} onChange={event => setSeller(event.target.value)} />
        </Field>
        {valid && sellerBps < buyerBps ? <Notice tone="amber">The seller would pay less than the buyer. That is allowed, but check it is meant.</Notice> : null}
      </div>
    </Dialog>
  );
}

/**
 * Settings > Fee rates: Afrippa's P2P fees per coin, for one market or every market, buyer and seller. Live, a market
 * needs a rate before ads are posted or orders opened. Finance changes them, after step-up; audited.
 */
export default function FeeRatesPage() {
  const admin = useAdmin();
  const query = useP2pFeeRatesQuery();
  const [remove] = useRemoveP2pFeeRateMutation();
  const [editing, setEditing] = useState<P2pFeeRate | "new" | null>(null);
  const [removing, setRemoving] = useState<P2pFeeRate | null>(null);
  const edits = can(admin, "finance");

  const columns: Array<Column<P2pFeeRate>> = [
    { key: "asset", header: "Coin", cell: rate => <span className="font-semibold text-ink">{rate.asset}</span> },
    { key: "market", header: "Market", cell: rate => marketLabel(rate.market) },
    { key: "buyer", header: "Buyer", cell: rate => formatBps(rate.buyer_bps) },
    {
      key: "seller",
      header: "Seller",
      cell: rate => (
        <span className="flex flex-wrap items-center gap-2">
          {formatBps(rate.seller_bps)}
          {rate.seller_bps < rate.buyer_bps ? <Badge tone="amber">Below the buyer&apos;s</Badge> : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: rate =>
        edits ? (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(rate)}>
              Change
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoving(rate)}>
              Remove
            </Button>
          </span>
        ) : null,
    },
  ];

  return (
    <AfrippaShell section="settings" current="/settings" crumbs={[{ label: "Settings", href: "/settings" }, { label: "Fee rates" }]}>
      <PageHeader
        title="Fee rates"
        description="What Afrippa charges on each P2P order, in the coin traded. A market's own rate wins over the every-market rate; live, a market without a rate cannot trade."
        actions={edits ? <Button onClick={() => setEditing("new")}>New rate</Button> : null}
      />
      <QueryView query={query} loading={<Skeleton className="h-64 w-full" />}>
        {data => (
          <Card>
            <DataTable<P2pFeeRate> caption="Fee rates" rows={data.data} rowKey={rate => `${rate.asset}:${rate.market ?? "*"}`} empty="No rates yet. Live trading needs one." columns={columns} />
            {editing ? <RateDialog rate={editing} maxBps={data.max_bps} onClose={() => setEditing(null)} /> : null}
          </Card>
        )}
      </QueryView>
      <ActionDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Remove this rate"
        description={removing ? `${removing.asset} in ${marketLabel(removing.market)} falls back to the every-market rate, if there is one.` : undefined}
        confirmLabel="Remove"
        tone="danger"
        requireReason={false}
        onConfirm={async () => {
          if (removing) await remove({ asset: removing.asset, market: removing.market }).unwrap();
          setRemoving(null);
        }}
      />
    </AfrippaShell>
  );
}
