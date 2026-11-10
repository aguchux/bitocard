import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { payName, type ShopSearch } from "@bitocard/api-client/classifieds";
import { ListingGrid } from "@/components/listing-card";
import { marketFor, shopApi } from "@/lib/api";
import { auctionPath } from "@/lib/auctions";

type Props = { params: Promise<{ cc: string }> };

/** Every listing at auction in a market (the search's `sale=auction`), kept a minute. */
async function atAuction(country: string) {
  const result = await shopApi<ShopSearch>(`/v1/classifieds/listings?country=${country}&sale=auction&limit=48`);
  return result.ok ? { ok: true, cards: result.data.data } : { ok: false, cards: [] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cc } = await params;
  const market = await marketFor(cc);
  const { cards } = market ? await atAuction(market.country) : { cards: [] };
  return {
    title: `Auctions in ${market?.name ?? "Udozo"}`,
    description: `Listings sold by auction on Udozo: bid, win and pay with ${payName}.`,
    alternates: { canonical: auctionPath(cc) },
    robots: cards.length ? undefined : { index: false, follow: true },
  };
}

/** A market's listings at auction: sellers' own and Udozo's, each bid on from its own page. */
export default async function AuctionsPage({ params }: Props) {
  const { cc } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const { ok, cards } = await atAuction(market.country);
  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 px-4 pt-5 pb-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Auctions in {market.name}</h1>
        <p className="mt-1 text-sm text-navy-600">
          Listings sold to the highest bid. Bid on its page; if you win, pay with {payName} and get it as you would any order.{" "}
          <Link href="/legal/auctions" className="font-semibold text-brand-700 underline">
            How auctions work
          </Link>
        </p>
      </div>
      {!ok ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="status">
          We could not load the auctions just now. Try again shortly.
        </p>
      ) : !cards.length ? (
        <p className="rounded-2xl border border-navy-100 bg-white p-4 text-navy-700">Nothing is at auction in {market.name} right now.</p>
      ) : (
        <ListingGrid cards={cards} source="auctions" />
      )}
    </div>
  );
}
