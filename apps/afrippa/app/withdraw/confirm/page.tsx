import type { Metadata } from "next";
import { WithdrawReviewBody } from "@afrippa/ui/money-views";
import { AccountShell } from "@/components/account-shell";
import { moneyLinks, requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Review withdrawal", robots: { index: false, follow: false } };

/** The withdrawal exactly as it will be sent (`@bitocard/crypto-ui`): nothing moves until the customer asks for the code. */
export default async function ReviewWithdrawalPage({ searchParams }: { searchParams: Promise<{ asset?: string; chain?: string; address?: string; amount?: string }> }) {
  const params = await searchParams;
  await requireCustomer("/withdraw");
  return (
    <AccountShell title="Review your withdrawal" current="/wallets">
      <WithdrawReviewBody api={customerApi} params={params} links={moneyLinks} />
    </AccountShell>
  );
}
