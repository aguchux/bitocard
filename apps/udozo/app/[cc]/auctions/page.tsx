/* eslint-disable @next/next/no-img-element -- lots' photos come from the media CDN as listings' do. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connectName, payName, shopMoney } from "@bitocard/api-client/classifieds";
import { marketFor } from "@/lib/api";
import { auctionsOf } from "@/lib/auction-reads";
import { auctionPath, auctionStatusWords, timeLeft } from "@/lib/auctions";

type Props = { params: Promise<{ cc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cc } = await params;
  const market = await marketFor(cc);
  const { lots } = await auctionsOf(cc);
  return {
    title: `Udozo auctions in ${market?.name ?? "Udozo"}`,
    description: `Items abandoned at ${connectName} Centres, auctioned by Udozo and paid with ${payName}.`,
    alternates: { canonical: auctionPath(cc) },
    robots: lots.length ? undefined : { index: false, follow: true },
  };
}

/** A market's Udozo auctions: lots bidding now, then lots opening soon. */
export default async function AuctionsPage({ params }: Props) {
  const { cc } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const { ok, lots } = await auctionsOf(cc);
  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 pt-5 pb-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Udozo auctions in {market.name}</h1>
        <p className="mt-1 text-sm text-navy-600">
          Items their sellers abandoned at {connectName} Centres, sold by Udozo as seen. Win, pay with {payName} and collect at Udozo&apos;s warehouse.{" "}
          <Link href="/legal/auctions" className="font-semibold text-brand-700 underline">
            How Udozo auctions work
          </Link>
        </p>
      </div>
      {!ok ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
          We could not load the auctions just now. Try again shortly.
        </p>
      ) : !lots.length ? (
        <p className="rounded-2xl border border-navy-100 bg-white p-4 text-navy-700">There is nothing at auction in {market.name} right now.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lots.map(lot => (
            <li key={lot.id}>
              <Link href={auctionPath(cc, lot.ref)} className="grid h-full overflow-hidden rounded-2xl border border-navy-100 bg-white hover:border-navy-300">
                {lot.photos[0] ? (
                  <img src={lot.photos[0]} alt="" className="aspect-[4/3] w-full object-cover" loading="lazy" />
                ) : (
                  <div className="aspect-[4/3] w-full bg-navy-50" aria-hidden />
                )}
                <div className="grid gap-1 p-3">
                  <p className="text-xs font-semibold text-navy-500">
                    {lot.number} · {auctionStatusWords[lot.status]}
                  </p>
                  <p className="line-clamp-2 font-bold text-navy-900">{lot.title}</p>
                  <p className="text-lg font-extrabold text-navy-900">
                    {shopMoney(lot.current_price ?? lot.start_price, lot.currency)}
                    <span className="ml-1 text-xs font-semibold text-navy-500">{lot.current_price === null ? "to start" : `${lot.bids} ${lot.bids === 1 ? "bid" : "bids"}`}</span>
                  </p>
                  <p className="text-sm text-navy-600">
                    {lot.status === "live" ? `Ends in ${timeLeft(lot.ends_at)}` : `Opens in ${timeLeft(lot.starts_at)}`} · {lot.warehouse.state}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
