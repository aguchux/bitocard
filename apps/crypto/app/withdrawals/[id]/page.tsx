import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { StoreCryptoWithdrawal } from "@bitocard/api-client/storefront";
import { isId, WithdrawalBody } from "@bitocard/crypto-ui/money-views";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Withdrawal", robots: { index: false, follow: false } };

/** One withdrawal (`@bitocard/crypto-ui`): what was sent where, its status, and the code to confirm it or a way to cancel. */
export default async function WithdrawalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireCustomer(`/withdrawals/${id}`);
  if (!isId(id)) notFound();
  const result = await customerApi<StoreCryptoWithdrawal>("GET", `/v1/afrippa/crypto/withdrawals/${id}`);
  if (!result.ok) notFound();
  return (
    <AccountShell title={`Withdrawal ${result.data.number}`} current="/wallets">
      <WithdrawalBody item={result.data} />
    </AccountShell>
  );
}
