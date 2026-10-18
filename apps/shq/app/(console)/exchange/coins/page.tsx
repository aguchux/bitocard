"use client";

import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Card, CardHeader, DataTable, errorMessage, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { type ResellerCoins, useResellerCoinsQuery, useResellerExchangeReservesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { coinAmount } from "../shared";
import { coinRoles, PremiumNotice } from "../coin-parts";

type Row = {
  asset: string;
  name: string;
  enabled: boolean;
  available: string;
  withdrawing: string;
  reserve: string | null;
};

const linkClass = "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-brand-500 bg-white px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50";

function Coins({ coins }: { coins: ResellerCoins }) {
  const { membership } = useReseller();
  const mover = can(membership, ...coinRoles);
  const reserves = useResellerExchangeReservesQuery();
  const reserve = new Map((reserves.data?.coins ?? []).map(coin => [coin.asset, coin.balance]));
  const rows: Row[] = coins.assets.map(coin => ({
    ...coin,
    reserve: reserve.get(coin.asset) ?? null,
  }));
  return (
    <div className="space-y-4">
      {coins.onchain ? null : <PremiumNotice />}
      {reserves.error ? <Notice tone="amber">{errorMessage(reserves.error)}</Notice> : null}
      <Card>
        <CardHeader
          title="Your coins"
          description="Coins in your wallet are yours to sell back to BitoCard, move into your desk reserve or, on Premium, withdraw on chain (deposits on Premium). Coins in your desk reserve are what your customers can buy from you."
        />
        <div className="mt-4">
          <DataTable<Row>
            caption="Your coins"
            rows={rows}
            rowKey={row => row.asset}
            empty="No coins are offered yet."
            columns={[
              {
                key: "coin",
                header: "Coin",
                cell: row => (
                  <span className="font-semibold text-ink">
                    {row.name} ({row.asset})
                  </span>
                ),
              },
              {
                key: "wallet",
                header: "Coin wallet",
                align: "right",
                cell: row => (
                  <span className="tabular-nums">
                    {coinAmount(row.available)} {row.asset}
                  </span>
                ),
              },
              {
                key: "withdrawing",
                header: "Withdrawing",
                align: "right",
                cell: row => <span className="tabular-nums text-muted">{Number(row.withdrawing) > 0 ? `${coinAmount(row.withdrawing)} ${row.asset}` : "—"}</span>,
              },
              {
                key: "reserve",
                header: "Desk reserve",
                align: "right",
                cell: row => <span className="tabular-nums">{row.reserve === null ? "—" : `${coinAmount(row.reserve)} ${row.asset}`}</span>,
              },
              ...(mover
                ? [
                    {
                      key: "move",
                      header: "On chain",
                      align: "right" as const,
                      cell: (row: Row) => (
                        <div className="flex flex-wrap justify-end gap-2">
                          {row.enabled && coins.onchain ? (
                            <Link href={`/exchange/deposit?asset=${row.asset}`} className={linkClass}>
                              <ArrowDownToLine className="size-4" aria-hidden />
                              Deposit
                            </Link>
                          ) : null}
                          {Number(row.available) > 0 ? (
                            <Link href={`/exchange/withdraw?asset=${row.asset}`} className={linkClass}>
                              <ArrowUpFromLine className="size-4" aria-hidden />
                              Withdraw
                            </Link>
                          ) : null}
                        </div>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      </Card>
      <p className="text-sm text-muted">
        Buy coins on{" "}
        <Link href="/exchange" className="font-semibold text-brand-600 hover:underline">
          Trade with BitoCard
        </Link>
        , and move them into or out of your reserve on{" "}
        <Link href="/exchange/desk" className="font-semibold text-brand-600 hover:underline">
          Your desk
        </Link>
        .
      </p>
    </div>
  );
}

/** The reseller's coin balances: its own coin wallet, what is on its way out on chain and what sits behind its customer desk. */
export default function ExchangeCoinsPage() {
  const coins = useResellerCoinsQuery();
  return (
    <ShqShell section="exchange" current="/exchange/coins" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Coins" }]}>
      <PageHeader title="Coins" description="What your business holds in each coin, in this mode." />
      <div className="mt-6">
        <QueryView query={coins} loading={<Skeleton className="h-72 w-full" />}>
          {data => <Coins coins={data} />}
        </QueryView>
      </div>
    </ShqShell>
  );
}
