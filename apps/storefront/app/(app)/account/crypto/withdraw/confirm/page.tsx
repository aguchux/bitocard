import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { WithdrawReviewBody } from "@bitocard/crypto-ui/money-views";
import { CryptoNav, moneyLinks } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Review withdrawal" };

/** The withdrawal exactly as it will be sent (`@bitocard/crypto-ui`): the address, the amount, the fee and the total. */
export default async function ReviewWithdrawalPage({ searchParams }: { searchParams: Promise<{ asset?: string; chain?: string; address?: string; amount?: string }> }) {
  const params = await searchParams;
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href={moneyLinks.withdraw(params.asset ?? "", params.chain ?? "")} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Back
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Review your withdrawal</h1>
      <CryptoNav current="/account/crypto/withdraw" />
      <WithdrawReviewBody api={customerApi} params={params} links={moneyLinks} />
    </div>
  );
}
