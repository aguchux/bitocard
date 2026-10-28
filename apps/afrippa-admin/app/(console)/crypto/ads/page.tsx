"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ActionDialog, Badge, Button, Card, DataTable, errorMessage, FilterSelect, formatMoney, PageHeader, type Column, type Tone } from "@bitocard/admin-ui";
import { AppLink, can, useAdmin } from "@bitocard/admin-ui/shell";
import { AfrippaShell as AdminShell } from "@/components/shell";
import { type Mode, type P2pAd, useCancelP2pAdMutation, useP2pAdsQuery } from "@bitocard/api-client/admin";

const statusTone: Record<P2pAd["status"], Tone> = { active: "green", paused: "amber", completed: "grey", cancelled: "grey" };

/** Crypto > P2P ads: every ad on the market. Operations can close one (what it locks goes back to its owner). */
export default function P2pAdsPage() {
  // useSearchParams needs a Suspense boundary (a customer's page links here with ?customer=<id>).
  return (
    <Suspense>
      <P2pAds />
    </Suspense>
  );
}

function P2pAds() {
  const admin = useAdmin();
  const customer = useSearchParams().get("customer") ?? undefined;
  const [mode, setMode] = useState<Mode>("live");
  const [status, setStatus] = useState("active");
  const ads = useP2pAdsQuery({ mode, ...(status ? { status } : {}), ...(customer ? { customer_id: customer } : {}) });
  const [cancel] = useCancelP2pAdMutation();
  const [closing, setClosing] = useState<P2pAd | null>(null);
  const editable = can(admin, "operations");

  const columns: Array<Column<P2pAd>> = [
    {
      key: "ad",
      header: "Ad",
      cell: ad => (
        <span className="block">
          <span className="block font-semibold text-ink">
            {ad.side === "sell" ? "Sells" : "Buys"} {ad.total} {ad.asset}
          </span>
          <span className="block text-xs text-muted">
            {ad.trader.nickname} · {ad.country}
          </span>
        </span>
      ),
    },
    { key: "price", header: "Price", cell: ad => `${formatMoney(ad.price, ad.currency)} / ${ad.asset}` },
    { key: "left", header: "Left", cell: ad => `${ad.available} ${ad.asset}`, hideOnMobile: true },
    { key: "limits", header: "Per trade", cell: ad => `${formatMoney(ad.min_fiat, ad.currency)} – ${formatMoney(ad.max_fiat, ad.currency)}`, hideOnMobile: true },
    {
      key: "owner",
      header: "Customer",
      hideOnMobile: true,
      cell: ad => (
        <AppLink href={`/crypto/customers/${ad.customer.id}`} className="text-brand-600 hover:underline">
          {ad.customer.email ?? ad.customer.id}
        </AppLink>
      ),
    },
    { key: "status", header: "Status", cell: ad => <Badge tone={statusTone[ad.status]}>{ad.status}</Badge> },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: ad =>
        editable && (ad.status === "active" || ad.status === "paused") ? (
          <Button size="sm" variant="danger" onClick={() => setClosing(ad)}>
            Close
          </Button>
        ) : null,
    },
  ];

  return (
    <AdminShell section="crypto" current="/crypto/ads" crumbs={[{ label: "Crypto", href: "/crypto" }, { label: "P2P ads" }]}>
      <PageHeader title="P2P ads" description="Ads customers posted. Sell ads lock their coins; buy ads lock the money they need. Closing an ad gives back what it still locks." />
      <div className="mt-6 flex flex-wrap gap-3">
        <FilterSelect id="ads-mode" label="Mode" value={mode} onChange={value => setMode(value as Mode)} options={[{ value: "live", label: "Live" }, { value: "test", label: "Test" }]} />
        <FilterSelect
          id="ads-status"
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "On the market" },
            { value: "paused", label: "Paused" },
            { value: "completed", label: "Completed" },
            { value: "cancelled", label: "Closed" },
            { value: "", label: "All" },
          ]}
        />
      </div>
      <Card className="mt-4">
        <DataTable columns={columns} rows={ads.data?.data} rowKey={ad => ad.id} loading={ads.isLoading} error={ads.error ? errorMessage(ads.error) : null} onRetry={ads.refetch} empty="No ads here." />
      </Card>
      <ActionDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title="Close this ad"
        description={closing ? `${closing.trader.nickname}'s ad leaves the market and what it still locks goes back to them.` : undefined}
        confirmLabel="Close ad"
        tone="danger"
        onConfirm={reason => cancel({ id: closing!.id, reason }).unwrap()}
      />
    </AdminShell>
  );
}
