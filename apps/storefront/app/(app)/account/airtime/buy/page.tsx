import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { BuyAirtimeForm } from "@/components/app/airtime/trade-forms";
import { airtimePool } from "@/lib/airtime";
import { chosenNetwork } from "@/lib/airtime-rules";
import { currentCustomer } from "@/lib/customer";
import { myPhones } from "@/lib/phones";
import { walletFor } from "@/lib/wallet";

export const metadata: Metadata = { title: "Buy airtime", robots: { index: false, follow: false } };

/** Buying airtime from the pool for less: the price first, then paid from the wallet and sent within the hour. */
export default async function BuyAirtimePage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const customer = await currentCustomer();
  if (!customer) redirect(`/signin?next=${encodeURIComponent("/account/airtime/buy")}`);
  const [{ network }, pool, numbers] = await Promise.all([searchParams, airtimePool(), myPhones()]);
  const phones = numbers?.data.map(item => item.phone) ?? [];
  const currency = pool?.currency ?? "NGN";
  const wallet = await walletFor(currency);
  const balance = wallet?.wallets.find(item => item.currency === currency)?.balance ?? null;
  const chosen = pool ? chosenNetwork(pool.networks, network) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/account/airtime" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Airtime exchange
      </Link>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Buy airtime for less</h1>
        <p className="mt-1 text-slate-600">From airtime other customers sold us. Paid from your {currency} wallet and sent within the hour, or your money back.</p>
      </div>
      {!pool || !pool.open || !chosen ? (
        <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">Buying from the pool is not open yet.</p>
      ) : (
        <BuyAirtimeForm networks={pool.networks} initial={chosen.network} phones={phones} currency={currency} balance={balance} />
      )}
    </div>
  );
}
