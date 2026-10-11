"use client";

import { Card, CardHeader, errorMessage, formatMoney, KeyValue, Notice, Skeleton } from "@bitocard/admin-ui";
import { useResellerWalletQuery } from "@bitocard/api-client/admin";

/** The reseller's live wallets: their country's currency (orders, earnings, withdrawals) and US dollars. */
export function ResellerWalletsCard({ resellerId }: { resellerId: string }) {
  const wallet = useResellerWalletQuery(resellerId);
  const wallets = wallet.data?.wallets ?? [];
  return (
    <Card>
      <CardHeader title="Wallets" description="Live balances: their country's currency and US dollars. Orders are held from the country wallet." />
      <div className="px-5 pb-5 sm:px-6">
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
      </div>
    </Card>
  );
}
