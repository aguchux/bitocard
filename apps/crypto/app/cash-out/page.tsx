import type { Metadata } from "next";
import { CashOutBody } from "@bitocard/crypto-ui/money-views";
import { AccountShell } from "@/components/account-shell";
import { moneyLinks, requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Cash out", robots: { index: false, follow: false } };

/** Paying P2P money out to the customer's own bank account, in their own country (`@bitocard/crypto-ui`). */
export default async function CashOutPage() {
  await requireCustomer("/cash-out");
  return (
    <AccountShell title="Cash out" current="/wallets">
      <CashOutBody api={customerApi} links={moneyLinks} />
    </AccountShell>
  );
}
