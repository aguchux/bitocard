"use client";

import { Suspense, useState } from "react";
import { Card, errorMessage, Notice, PageHeader, QueryView, Skeleton } from "@bitocard/admin-ui";
import { type CoinWithdrawal, type ResellerCoins, useCoinWithdrawalAddressesQuery, useCoinWithdrawalNetworksQuery, useResellerCoinsQuery } from "@bitocard/api-client/reseller";
import { ShqShell } from "@/components/shq-shell";
import { choosableCoins, CoinSelect, useChosenAsset } from "../coin-parts";
import { CodeDialog } from "./code-dialog";
import { Addresses } from "./addresses";
import { WithdrawForm } from "./withdraw-form";
import { Withdrawals } from "./withdrawals";

function Withdraw({ coins }: { coins: ResellerCoins }) {
  const offered = choosableCoins(coins, "withdraw");
  const asset = useChosenAsset(offered);
  const coin = offered.find(item => item.asset === asset);
  // Withdrawing what is held is open on every plan (only deposits are Premium), so coins are never trapped.
  const networks = useCoinWithdrawalNetworksQuery(asset ?? "", { skip: !asset });
  const addresses = useCoinWithdrawalAddressesQuery();
  const [asking, setAsking] = useState<CoinWithdrawal | null>(null);
  const firstChain = networks.data?.data[0]?.chain ?? coins.withdrawal_chains[0]?.chain ?? "";
  if (!asset || !coin) return <Notice tone="amber">No coins can be withdrawn now.</Notice>;
  return (
    <div className="space-y-4">
      <Card className="p-5 sm:p-6">
        <h2 className="text-lg font-bold text-ink">Withdraw coins</h2>
        <p className="mt-1 text-sm text-muted">Send coins from your BitoCard coin wallet to one of your saved addresses. A 6-digit code is emailed to you to confirm.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <CoinSelect coins={offered} value={asset} path="/exchange/withdraw" />
        </div>
        <div className="mt-4">
          {networks.error && !networks.data ? (
            <Notice tone="amber">{errorMessage(networks.error)}</Notice>
          ) : networks.data && addresses.data ? (
            <WithdrawForm key={asset} asset={asset} decimals={coin.decimals} available={coin.available} networks={networks.data} addresses={addresses.data.data} onAsked={setAsking} />
          ) : addresses.error ? (
            <Notice tone="amber">{errorMessage(addresses.error)}</Notice>
          ) : (
            <Skeleton className="h-28 w-full" />
          )}
        </div>
      </Card>
      {addresses.data ? <Addresses addresses={addresses.data.data} chain={firstChain} chains={coins.withdrawal_chains} /> : null}
      <Withdrawals onEnterCode={setAsking} />
      <CodeDialog key={asking?.id ?? "closed"} withdrawal={asking} onClose={() => setAsking(null)} />
    </div>
  );
}

/** Withdrawing the business's own coins on chain (Premium), confirmed with an emailed code. */
export default function ExchangeWithdrawPage() {
  const coins = useResellerCoinsQuery();
  return (
    <ShqShell section="exchange" current="/exchange/withdraw" crumbs={[{ label: "Exchange", href: "/exchange" }, { label: "Coins", href: "/exchange/coins" }, { label: "Withdraw" }]}>
      <PageHeader title="Withdraw" description="Send your coins on chain, in this mode." />
      <div className="mt-6">
        <QueryView query={coins} loading={<Skeleton className="h-72 w-full" />}>
          {data => (
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <Withdraw coins={data} />
            </Suspense>
          )}
        </QueryView>
      </div>
    </ShqShell>
  );
}
