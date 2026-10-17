"use client";

import { useState } from "react";
import { Badge, Button, Card, CardHeader, DataTable, errorMessage, FilterSelect, formatDateTime, Input, Notice, PageHeader, Toggle, type Column, type Tone } from "@bitocard/admin-ui";
import { AdminShell, AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type CryptoAsset, type CryptoReconciliation, type Mode, useCryptoAssetsQuery, useCryptoReconciliationsQuery, useRunCryptoReconciliationMutation, useUpdateCryptoAssetMutation } from "@bitocard/api-client/admin";

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

/**
 * An exchange amount in the coin that can be left blank: the 24-hour limit per customer or reseller trading with a desk
 * (blank: no limit), or the reserve level below which admins are told (blank: never).
 */
function OptionalAmountField({ asset, field, label, blank, editable }: { asset: CryptoAsset; field: "exchange_daily_limit" | "exchange_reserve_alert"; label: string; blank: string; editable: boolean }) {
  const [update, state] = useUpdateCryptoAssetMutation();
  const saved = asset[field] ?? null;
  const [value, setValue] = useState(saved ?? "");
  const next = value.trim() === "" ? null : value.trim();
  const valid = next === null || /^\d+(\.\d+)?$/.test(next);
  if (asset[field] === undefined) return <span className="text-muted">—</span>;
  if (!editable) return <span>{saved ?? blank}</span>;
  return (
    <span className="flex items-center justify-end gap-2">
      <label htmlFor={`${field}-${asset.code}`} className="sr-only">
        {asset.code} {label}
      </label>
      <Input id={`${field}-${asset.code}`} inputMode="decimal" className="w-28" placeholder={blank} value={value} onChange={event => setValue(event.target.value)} />
      <Button size="sm" variant="secondary" disabled={!valid || next === saved} loading={state.isLoading} onClick={() => void update({ code: asset.code, [field]: next })}>
        Save
      </Button>
      {state.error ? <span className="text-xs text-red-700">{errorMessage(state.error)}</span> : null}
    </span>
  );
}

const checkTones: Record<CryptoReconciliation["status"], Tone> = { matched: "green", surplus: "blue", shortfall: "red", unavailable: "grey" };

/** The daily custody check: per asset, what the ledger expects on chain against what the signer's wallets hold. */
function CustodyCheck({ runs }: { runs: boolean }) {
  const [mode, setMode] = useState<Mode>("live");
  const checks = useCryptoReconciliationsQuery(mode);
  const [run, state] = useRunCryptoReconciliationMutation();
  const columns: Array<Column<CryptoReconciliation>> = [
    { key: "asset", header: "Asset", cell: item => <span className="font-semibold text-ink">{item.asset}</span> },
    { key: "expected", header: "Ledger expects", align: "right", cell: item => item.expected },
    { key: "held", header: "Signer holds", align: "right", cell: item => (item.status === "unavailable" ? "—" : item.held) },
    {
      key: "status",
      header: "Check",
      align: "right",
      cell: item => (
        <span className="flex flex-col items-end gap-1">
          <Badge tone={checkTones[item.status]}>{item.status === "shortfall" || item.status === "surplus" ? `${item.status} ${item.difference}` : item.status}</Badge>
          <span className="text-xs text-muted">{formatDateTime(item.created_at)}</span>
        </span>
      ),
    },
  ];
  return (
    <Card>
      <CardHeader
        title="Custody check"
        description="Daily: customers' crypto and BitoCard's fees in custody (less withdrawals on their way, plus deposits arriving) against what the signer's wallets hold. A shortfall is urgent."
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <FilterSelect id="custody-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
            {runs ? (
              <Button size="sm" variant="secondary" loading={state.isLoading} onClick={() => void run(mode)}>
                Check now
              </Button>
            ) : null}
          </span>
        }
      />
      <div className="space-y-3 p-5 sm:px-6">
        {state.data?.error ? <Notice tone="amber">{state.data.error}</Notice> : null}
        {state.error ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      </div>
      <DataTable columns={columns} rows={checks.data?.data} rowKey={item => item.id} loading={checks.isLoading} error={checks.error ? errorMessage(checks.error) : null} onRetry={checks.refetch} empty="No checks yet." />
    </Card>
  );
}

/** Crypto > Assets: which coins customers can hold and trade, BitoCard's P2P fee on each, withdrawal and exchange limits. */
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
      key: "exchange-limit",
      header: "Exchanged a day (each trader)",
      align: "right",
      cell: asset => <OptionalAmountField key={asset.exchange_daily_limit ?? ""} asset={asset} field="exchange_daily_limit" label="daily exchange limit" blank="No limit" editable={editable} />,
    },
    {
      key: "exchange-alert",
      header: "Reserve alert below",
      align: "right",
      hideOnMobile: true,
      cell: asset => <OptionalAmountField key={asset.exchange_reserve_alert ?? ""} asset={asset} field="exchange_reserve_alert" label="exchange reserve alert" blank="No alert" editable={editable} />,
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
        description="Coins customers can hold and trade. BitoCard's P2P fee is taken in the coin from what the buyer receives. Withdrawals from the approval amount wait for finance (0: none do). The exchange limit caps what one customer or reseller trades with an exchange desk in 24 hours; admins are told when BitoCard's coin reserve falls below the alert (blank: no limit, no alert)."
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
        {can(admin, "operations", "finance") ? <CustodyCheck runs /> : null}
      </div>
    </AdminShell>
  );
}
