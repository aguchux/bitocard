import type { Metadata } from "next";
import { DepositBody } from "@bitocard/crypto-ui/money-views";
import { AccountShell } from "@/components/account-shell";
import { moneyLinks, requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Deposit crypto", robots: { index: false, follow: false } };

/** Depositing coins (`@bitocard/crypto-ui`, shared with the storefront's Crypto tab): the coin, its network, then the customer's own address with its QR code. */
export default async function DepositPage({ searchParams }: { searchParams: Promise<{ asset?: string; chain?: string }> }) {
  await requireCustomer("/deposit");
  return (
    <AccountShell title="Deposit crypto" current="/wallets">
      <DepositBody api={customerApi} params={await searchParams} links={moneyLinks} />
    </AccountShell>
  );
}
