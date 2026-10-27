import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound } from "next/navigation";
import type { StoreCryptoWithdrawal } from "@bitocard/api-client/storefront";
import { isId, WithdrawalBody } from "@bitocard/crypto-ui/money-views";
import { CryptoNav, moneyLinks } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Withdrawal" };

/** One withdrawal (`@bitocard/crypto-ui`): what was sent where, its status, and the code to confirm it or a way to cancel. */
export default async function WithdrawalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isId(id)) notFound();
  const result = await customerApi<StoreCryptoWithdrawal>("GET", `/v1/store/crypto/withdrawals/${id}`);
  if (!result.ok) notFound();
  const item = result.data;
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href={moneyLinks.withdraw(item.asset, item.chain)} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Withdraw
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Withdrawal {item.number}</h1>
      <CryptoNav current="/account/crypto/withdraw" />
      <WithdrawalBody item={item} />
    </div>
  );
}
