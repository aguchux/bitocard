import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connectName } from "@bitocard/api-client/classifieds";
import { markets } from "@/lib/api";
import { centresPathFor } from "@/lib/connect-centres";
import { currentMarketChoice } from "@/lib/market-choice-server";

export const metadata: Metadata = { title: `${connectName} Centres`, robots: { index: false, follow: true } };

/** The help menu's Connect Centres: the shopper's chosen market's list, else a choice of the open markets. */
export default async function ConnectCentresChooser() {
  const open = (await markets()).data;
  const path = centresPathFor(await currentMarketChoice(), open);
  if (path) redirect(path);
  return (
    <div className="mx-auto grid max-w-2xl gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">{connectName} Centres</h1>
      <p className="text-sm text-navy-600">Choose your country to see its centres.</p>
      {open.length ? (
        <ul className="grid gap-2 sm:grid-cols-2">
          {open.map(market => (
            <li key={market.country}>
              <Link href={`/${market.country.toLowerCase()}/connect-centres`} className="block rounded-2xl border border-navy-100 bg-white p-4 font-semibold text-navy-900 hover:border-navy-300">
                {market.name}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">We could not load the countries just now. Try again shortly.</p>
      )}
    </div>
  );
}
