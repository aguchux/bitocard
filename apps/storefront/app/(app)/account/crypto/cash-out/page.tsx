import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { CashOutBody } from "@bitocard/crypto-ui/money-views";
import { CryptoNav, moneyLinks } from "@/components/app/crypto";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Cash out" };

/** Paying P2P money out to the customer's own bank account (`@bitocard/crypto-ui`, shared with BitoCard Crypto). */
export default async function CashOutPage() {
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <Link href="/account/crypto/wallets" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Wallets
      </Link>
      <h1 className="font-display text-2xl font-extrabold text-navy-900">Cash out</h1>
      <CryptoNav current="/account/crypto/cash-out" />
      <CashOutBody api={customerApi} links={moneyLinks} />
    </div>
  );
}
