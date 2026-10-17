"use client";

import { PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { useResellerExchangeReservesQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { can, useReseller } from "@/components/reseller";
import { exchangeRoles } from "./shared";
import { TradePanel } from "./trade-panel";

/** The reseller buys coins from BitoCard with its wallets, or sells them back. */
export default function ExchangePage() {
  const { membership } = useReseller();
  // The reserves name the reseller's two wallet currencies (the country's first, then US dollars).
  const reserves = useResellerExchangeReservesQuery();
  return (
    <ShqShell section="exchange" current="/exchange" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Trade with BitoCard" }]}>
      <PageHeader title="Trade with BitoCard" description="Buy coins from BitoCard with your local or US dollar wallet, or sell coins back. BitoCard controls when exchange is available for your business." />
      <div className="mt-6">
        <QueryView query={reserves} loading={<Skeleton className="h-80 w-full" />}>
          {data => {
            const currencies = data.wallets.map(wallet => wallet.currency);
            return <TradePanel key={currencies.join()} currencies={currencies.length ? currencies : ["USD"]} canTrade={can(membership, ...exchangeRoles)} />;
          }}
        </QueryView>
      </div>
    </ShqShell>
  );
}
