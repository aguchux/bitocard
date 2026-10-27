import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { DepositBody } from "@bitocard/crypto-ui/money-views";
import { CryptoNav, moneyLinks } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Deposit crypto" };

/** Depositing crypto (`@bitocard/crypto-ui`, shared with BitoCard Crypto): the coin, its network, then the customer's own address. */
export default async function DepositPage({ searchParams }: { searchParams: Promise<{ asset?: string; chain?: string }> }) {
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/wallets" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Wallets
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Deposit crypto</h1>
      <CryptoNav current="/account/crypto/deposit" />
      <DepositBody api={customerApi} params={await searchParams} links={moneyLinks} />
    </div>
  );
}
