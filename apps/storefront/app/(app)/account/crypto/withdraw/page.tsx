import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { WithdrawBody } from "@bitocard/crypto-ui/money-views";
import { CryptoNav, moneyLinks } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Withdraw crypto" };

/** Withdrawing crypto (`@bitocard/crypto-ui`, shared with BitoCard Crypto): the coin, its network, a saved address and the amount. */
export default async function WithdrawPage({ searchParams }: { searchParams: Promise<{ asset?: string; chain?: string }> }) {
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/wallets" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Wallets
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Withdraw crypto</h1>
      <CryptoNav current="/account/crypto/withdraw" />
      <WithdrawBody api={customerApi} params={await searchParams} links={moneyLinks} />
    </div>
  );
}
