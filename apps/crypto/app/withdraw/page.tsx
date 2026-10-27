import type { Metadata } from "next";
import { WithdrawBody } from "@bitocard/crypto-ui/money-views";
import { AccountShell } from "@/components/account-shell";
import { moneyLinks, requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Withdraw crypto", robots: { index: false, follow: false } };

/** Withdrawing coins (`@bitocard/crypto-ui`): the coin, its network with the fee, a saved address and the amount. */
export default async function WithdrawPage({ searchParams }: { searchParams: Promise<{ asset?: string; chain?: string }> }) {
  await requireCustomer("/withdraw");
  return (
    <AccountShell title="Withdraw crypto" current="/wallets">
      <WithdrawBody api={customerApi} params={await searchParams} links={moneyLinks} />
    </AccountShell>
  );
}
