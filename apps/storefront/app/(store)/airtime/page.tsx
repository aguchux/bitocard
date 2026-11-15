import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AirtimePoolBoard } from "@/components/app/airtime/pool-board";
import { airtimePool } from "@/lib/airtime";
import { currentCustomer } from "@/lib/customer";
import { currentStore } from "@/lib/store";

export const metadata: Metadata = {
  title: "Airtime exchange",
  description: "Sell airtime you will not use, or buy airtime for less: BitoCard's live airtime pool for MTN, Airtel, Glo and 9mobile.",
};

/** The airtime pool on bitocard.com, for everyone: live per network, with Sell and Buy (through sign-in when signed out). */
export default async function PublicAirtimePage() {
  if ((await currentStore()).store) notFound();
  const [pool, customer] = await Promise.all([airtimePool(), currentCustomer()]);
  return (
    <div className="space-y-6">
      <div className="rounded-3xl bg-navy-950 p-5 text-white sm:p-8">
        <h1 className="font-display text-2xl font-extrabold sm:text-3xl">Airtime exchange</h1>
        <p className="mt-2 max-w-2xl text-white/80">Sell airtime you will not use, or buy airtime for less than its value. Everyone sees the same pool, updated as people trade.</p>
      </div>
      {pool ? (
        <AirtimePoolBoard pool={pool} signedIn={Boolean(customer)} />
      ) : (
        <p className="rounded-3xl bg-white p-5 text-slate-600 ring-1 ring-slate-200/70">We could not load the pool. Try again shortly.</p>
      )}
    </div>
  );
}
