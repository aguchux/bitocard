"use client";

import { Card, CardHeader, errorMessage, formatMoney, KeyValue, Notice, Skeleton } from "@bitocard/admin-ui";
import { useResellerWalletQuery } from "@bitocard/api-client/admin";
import { WalletTopUp } from "@/components/wallet-top-up";

/** The reseller's live wallets: their country's currency (orders, earnings, withdrawals) and US dollars, and manual top-ups. */
export function ResellerWalletsCard({ resellerId, resellerName }: { resellerId: string; resellerName: string }) {
  const wallet = useResellerWalletQuery(resellerId);
  const wallets = wallet.data?.wallets ?? [];
  return (
    <Card>
      <CardHeader title="Wallets" description="Live balances: their country's currency and US dollars. Premium, domains and the setup fee are paid from the country wallet." />
      <div className="space-y-5 px-5 pb-5 sm:px-6">
        {wallet.isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : !wallet.data && wallet.error ? (
          <Notice tone="red">{errorMessage(wallet.error)}</Notice>
        ) : (
          <KeyValue
            items={wallets.map(item => ({
              label: item.currency === "USD" ? "US dollars" : `${item.currency} (country)`,
              value: `${formatMoney(item.available, item.currency)} available${item.reserved ? `, ${formatMoney(item.reserved, item.currency)} reserved` : ""}`,
            }))}
          />
        )}
        {wallets.length ? (
          <div className="border-t border-line pt-4">
            <WalletTopUp
              target={{ type: "reseller", id: resellerId }}
              targetName={resellerName}
              currencies={wallets.map(item => ({ code: item.currency, currency: item.currency, label: item.currency === "USD" ? "US dollars" : `${item.currency} (country)` }))}
            />
          </div>
        ) : null}
      </div>
    </Card>
  );
}
