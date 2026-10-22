import type { Metadata } from "next";
import Link from "next/link";
import type { StoreSpinRewards } from "@bitocard/api-client/storefront";
import { PublicSpinPage } from "@/components/store/public-spin-page";
import { PublicSpinClaimDialog } from "@/components/app/public-spin-claim-dialog";
import { customerApi, currentCustomer } from "@/lib/customer";
import { pendingPublicSpinClaim, publicSpinRewards } from "@/lib/spin-actions";

export const metadata: Metadata = {
  title: "Spin and win",
  description: "Take six free spins and save your BitoCard wins to spend in the store.",
  alternates: { canonical: "/spin" },
};

export default async function SpinPage() {
  const customer = await currentCustomer();
  const [rewards, claim] = await Promise.all([
    customer ? customerApi<StoreSpinRewards>("GET", "/v1/store/spins").then(result => (result.ok ? result.data : null)) : publicSpinRewards(),
    customer ? pendingPublicSpinClaim() : Promise.resolve(null),
  ]);
  if (!rewards) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="font-display text-4xl font-black text-navy-900">Spin and win</h1>
        <p className="mt-3 text-slate-600">Choose a country where Customer Catcher is open, then come back to spin.</p>
        <Link href="/?market=1" className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-brand-500 px-5 font-bold text-white hover:bg-brand-600">Choose my country</Link>
      </div>
    );
  }
  return <><PublicSpinPage rewards={rewards} visitor={!customer} /><PublicSpinClaimDialog initial={claim} /></>;
}
