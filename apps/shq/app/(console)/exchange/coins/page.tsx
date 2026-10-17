"use client";

import Link from "next/link";
import { Card, CardHeader, DataTable, errorMessage, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { type ExchangeReserves, useResellerExchangeOverviewQuery, useResellerExchangeReservesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { coinAmount } from "../shared";

type Row = { asset: string; name: string; wallet: string | null; reserve: string };

function Coins({ reserves }: { reserves: ExchangeReserves }) {
  // The coin wallet is reported with BitoCard's prices, in the country's wallet currency.
  const currency = reserves.wallets[0]?.currency ?? "USD";
  const overview = useResellerExchangeOverviewQuery(currency);
  const held = new Map((overview.data?.assets ?? []).map(asset => [asset.asset, "your_coins" in asset ? asset.your_coins : null]));
  const rows: Row[] = reserves.coins.map(coin => ({ asset: coin.asset, name: coin.name, wallet: held.get(coin.asset) ?? null, reserve: coin.balance }));
  return (
    <div className="space-y-4">
      {overview.error ? <Notice tone="amber">{errorMessage(overview.error)}</Notice> : null}
      <Card>
        <CardHeader title="Your coins" description="Coins in your wallet are yours to sell back to BitoCard or move into your desk reserve. Coins in your desk reserve are what your customers can buy from you." />
        <div className="mt-4">
          <DataTable<Row>
            caption="Your coins"
            rows={rows}
            loading={overview.isLoading}
            rowKey={row => row.asset}
            empty="No coins are offered yet."
            columns={[
              { key: "coin", header: "Coin", cell: row => <span className="font-semibold text-ink">{row.name} ({row.asset})</span> },
              {
                key: "wallet",
                header: "Coin wallet",
                align: "right",
                cell: row => (row.wallet === null ? <span className="text-muted" title="BitoCard is not trading this coin now, so its balance is not shown">Unavailable now</span> : <span className="tabular-nums">{coinAmount(row.wallet)} {row.asset}</span>),
              },
              { key: "reserve", header: "Desk reserve", align: "right", cell: row => <span className="tabular-nums">{coinAmount(row.reserve)} {row.asset}</span> },
            ]}
          />
        </div>
      </Card>
      <p className="text-sm text-muted">
        Buy coins on <Link href="/exchange" className="font-semibold text-brand-600 hover:underline">Trade with BitoCard</Link>, and move them into or out of your reserve on <Link href="/exchange/desk" className="font-semibold text-brand-600 hover:underline">Your desk</Link>.
      </p>
    </div>
  );
}

/** The reseller's coin balances: its own coin wallet and what sits behind its customer desk. */
export default function ExchangeCoinsPage() {
  const reserves = useResellerExchangeReservesQuery();
  return (
    <ShqShell section="exchange" current="/exchange/coins" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Coins" }]}>
      <PageHeader title="Coins" description="What your business holds in each coin, in this mode." />
      <div className="mt-6">
        <QueryView query={reserves} loading={<Skeleton className="h-72 w-full" />}>
          {data => <Coins reserves={data} />}
        </QueryView>
      </div>
    </ShqShell>
  );
}
