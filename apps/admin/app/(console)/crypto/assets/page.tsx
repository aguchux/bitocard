"use client";

import { useState } from "react";
import { Button, Card, DataTable, errorMessage, Input, Notice, PageHeader, Toggle, type Column } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type CryptoAsset, useCryptoAssetsQuery, useUpdateCryptoAssetMutation } from "@bitocard/api-client/admin";

/** The fee as a percentage, saved in basis points (0 to 10%). */
function FeeField({ asset, editable }: { asset: CryptoAsset; editable: boolean }) {
  const [update, state] = useUpdateCryptoAssetMutation();
  const [value, setValue] = useState(String(asset.p2p_fee_bps / 100));
  const bps = Math.round(Number(value) * 100);
  const valid = Number.isFinite(bps) && bps >= 0 && bps <= 1000;
  if (!editable) return <span>{asset.p2p_fee_bps / 100}%</span>;
  return (
    <span className="flex items-center justify-end gap-2">
      <label htmlFor={`fee-${asset.code}`} className="sr-only">
        {asset.code} P2P fee in percent
      </label>
      <Input id={`fee-${asset.code}`} inputMode="decimal" className="w-20" value={value} onChange={event => setValue(event.target.value)} />
      <span className="text-sm text-muted">%</span>
      <Button size="sm" variant="secondary" disabled={!valid || bps === asset.p2p_fee_bps} loading={state.isLoading} onClick={() => void update({ code: asset.code, p2p_fee_bps: bps })}>
        Save
      </Button>
    </span>
  );
}

/** A withdrawal amount in the coin: the 24-hour limit per customer, or the amount from which an admin approves. */
function AmountField({ asset, field, label, editable }: { asset: CryptoAsset; field: "withdrawal_daily_limit" | "withdrawal_review_from"; label: string; editable: boolean }) {
  const [update, state] = useUpdateCryptoAssetMutation();
  const [value, setValue] = useState(asset[field]);
  const valid = /^\d+(\.\d+)?$/.test(value.trim());
  if (!editable) return <span>{asset[field]}</span>;
  return (
    <span className="flex items-center justify-end gap-2">
      <label htmlFor={`${field}-${asset.code}`} className="sr-only">
        {asset.code} {label}
      </label>
      <Input id={`${field}-${asset.code}`} inputMode="decimal" className="w-28" value={value} onChange={event => setValue(event.target.value)} />
      <Button size="sm" variant="secondary" disabled={!valid || value.trim() === asset[field]} loading={state.isLoading} onClick={() => void update({ code: asset.code, [field]: value.trim() })}>
        Save
      </Button>
      {state.error ? <span className="text-xs text-red-700">{errorMessage(state.error)}</span> : null}
    </span>
  );
}

/** Crypto > Assets: which coins customers can hold and trade, BitoCard's P2P fee on each, and withdrawal limits. */
export default function CryptoAssetsPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const assets = useCryptoAssetsQuery();
  const [update, state] = useUpdateCryptoAssetMutation();
  const columns: Array<Column<CryptoAsset>> = [
    {
      key: "asset",
      header: "Asset",
      cell: asset => (
        <span className="block">
          <span className="block font-semibold text-ink">{asset.code}</span>
          <span className="block text-xs text-muted">
            {asset.name} · {asset.decimals} decimal places
          </span>
        </span>
      ),
    },
    { key: "fee", header: "P2P fee", align: "right", cell: asset => <FeeField key={asset.p2p_fee_bps} asset={asset} editable={editable} /> },
    {
      key: "limit",
      header: "Withdrawals a day (each customer)",
      align: "right",
      cell: asset => <AmountField key={asset.withdrawal_daily_limit} asset={asset} field="withdrawal_daily_limit" label="daily withdrawal limit" editable={editable} />,
    },
    {
      key: "review",
      header: "Approval from",
      align: "right",
      hideOnMobile: true,
      cell: asset => <AmountField key={asset.withdrawal_review_from} asset={asset} field="withdrawal_review_from" label="withdrawals approved from" editable={editable} />,
    },
    {
      key: "enabled",
      header: "Customers can trade it",
      align: "right",
      cell: asset => <Toggle checked={asset.enabled} disabled={!editable} label={`${asset.code} available`} onChange={enabled => void update({ code: asset.code, enabled })} />,
    },
  ];
  return (
    <AdminShell section="crypto" current="/crypto/assets" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "Assets" }]}>
      <PageHeader
        title="Assets"
        description="Coins customers can hold and trade. BitoCard's P2P fee is taken in the coin from what the buyer receives. Withdrawals from the approval amount wait for finance (0: none do)."
      />
      <div className="mt-6 space-y-4">
        <Notice tone="amber">
          Crypto and P2P are off until switched on per market or store (
          <AppLink href="/settings" className="font-semibold underline">
            Feature switches
          </AppLink>
          : crypto_wallets and p2p_trading). Take legal advice for each market first.
        </Notice>
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
        <Card>
          <DataTable columns={columns} rows={assets.data?.data} rowKey={asset => asset.code} loading={assets.isLoading} error={assets.error ? errorMessage(assets.error) : null} onRetry={assets.refetch} />
        </Card>
      </div>
    </AdminShell>
  );
}
