import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { SellAirtimeForm } from "@/components/app/airtime/trade-forms";
import { airtimePool, mySellerStatus } from "@/lib/airtime";
import { chosenNetwork } from "@/lib/airtime-rules";
import { currentCustomer } from "@/lib/customer";
import { myPhones } from "@/lib/phones";

export const metadata: Metadata = { title: "Sell airtime", robots: { index: false, follow: false } };

/** Selling unused airtime to BitoCard: the network and amount, then (on the sale's page) the number to send it to. */
export default async function SellAirtimePage({ searchParams }: { searchParams: Promise<{ network?: string }> }) {
  const customer = await currentCustomer();
  if (!customer) redirect(`/signin?next=${encodeURIComponent("/account/airtime/sell")}`);
  const [{ network }, pool, numbers, seller] = await Promise.all([searchParams, airtimePool(customer.country ?? "NG"), myPhones(), mySellerStatus()]);
  const phones = numbers?.data.map(item => item.phone) ?? [];
  const chosen = pool ? chosenNetwork(pool.networks, network) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/account/airtime" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-navy-900">
        <ChevronLeft className="size-4" aria-hidden="true" /> Airtime exchange
      </Link>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Sell unused airtime</h1>
        <p className="mt-1 text-slate-600">Send it to our number from your own line. Once it arrives and a short hold has passed, the money is in your wallet.</p>
      </div>
      {!pool || !pool.open || !chosen ? (
        <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">Selling airtime is not open yet.</p>
      ) : (
        <SellAirtimeForm networks={pool.networks} initial={chosen.network} phones={phones} currency={pool.currency ?? "NGN"} seller={seller} />
      )}
    </div>
  );
}
