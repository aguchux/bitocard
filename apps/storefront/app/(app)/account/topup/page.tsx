import type { Metadata } from "next";
import { TopUpForm } from "@/components/store/top-up-form";
import { currentCustomer } from "@/lib/customer";
import { walletFor } from "@/lib/wallet";

export const metadata: Metadata = { title: "Top up", robots: { index: false, follow: false } };

/**
 * Airtime and data in two fields: phone number and amount (or a bundle, for data). The network is found from the
 * number itself, never chosen from a list first. Paid straight from the wallet.
 */
export default async function TopUpPage() {
  const customer = await currentCustomer();
  const country = customer?.country ?? null;
  const wallet = customer && country ? await walletFor() : null;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Top up</h1>
        <p className="mt-1 text-slate-600">Enter the number. We find the network and quote the price before you pay.</p>
      </div>
      {country ? (
        <TopUpForm country={country} currency={customer?.currency ?? undefined} wallet={wallet} signedIn={Boolean(customer)} back="/account/topup" />
      ) : (
        <p className="rounded-3xl bg-white p-6 text-slate-600 ring-1 ring-slate-200/70">Sign in to top up from your wallet.</p>
      )}
    </div>
  );
}
