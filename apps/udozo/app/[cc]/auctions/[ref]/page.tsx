/* eslint-disable @next/next/no-img-element -- lots' photos come from the media CDN as listings' do. */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { payName, shopMoney } from "@bitocard/api-client/classifieds";
import { LotActions } from "@/components/auction-lot";
import { marketFor } from "@/lib/api";
import { auctionLot } from "@/lib/auction-reads";
import { auctionPath, auctionStatusWords, lotNext, timeLeft } from "@/lib/auctions";

type Props = { params: Promise<{ cc: string; ref: string }> };
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { cc, ref } = await params;
  const lot = await auctionLot(ref);
  return {
    title: lot ? `${lot.title}: Udozo auction ${lot.number}` : "Udozo auction",
    alternates: { canonical: auctionPath(cc, ref) },
    // Lots come and go within days: never a page for search engines.
    robots: { index: false, follow: true },
  };
}

/** One lot: its photos and description, where it is, the price and bids, the rules, and bidding, paying or collecting. */
export default async function LotPage({ params }: Props) {
  const { cc, ref } = await params;
  const market = await marketFor(cc);
  const lot = await auctionLot(ref);
  if (!market || !lot || lot.country !== market.country) notFound();
  const next = lotNext(lot);
  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 pt-5 pb-8 lg:grid-cols-[1fr_22rem]">
      <div className="grid min-w-0 content-start gap-4">
        <Link href={auctionPath(cc)} className="text-sm font-semibold text-brand-700 underline">
          All auctions in {market.name}
        </Link>
        <div>
          <p className="text-xs font-semibold text-navy-500">
            {lot.number} · {auctionStatusWords[lot.status]}
          </p>
          <h1 className="text-2xl font-extrabold tracking-tight">{lot.title}</h1>
        </div>
        {lot.photos.length ? (
          <ul className="flex snap-x gap-2 overflow-x-auto" aria-label="Photos">
            {lot.photos.map((photo, index) => (
              <li key={photo} className="w-4/5 shrink-0 snap-start sm:w-2/3">
                <img src={photo} alt={`Photo ${index + 1} of ${lot.photos.length}`} className="aspect-[4/3] w-full rounded-2xl object-cover" />
              </li>
            ))}
          </ul>
        ) : null}
        {lot.description ? <p className="whitespace-pre-line text-navy-800">{lot.description}</p> : null}
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          Sold as seen, from an abandoned shipment: Udozo has not tested it. Collect it at {lot.warehouse.name}, {lot.warehouse.state}.
        </p>
      </div>

      <aside className="grid content-start gap-3 rounded-2xl border border-navy-100 bg-white p-4">
        <div>
          <p className="text-sm text-navy-600">{lot.current_price === null ? "Starting price" : "Highest bid"}</p>
          <p className="text-3xl font-extrabold text-navy-900">{shopMoney(lot.current_price ?? lot.start_price, lot.currency)}</p>
          <p className="text-sm text-navy-600">
            {lot.bids} {lot.bids === 1 ? "bid" : "bids"} ·{" "}
            {lot.status === "live" ? `ends in ${timeLeft(lot.ends_at)} (${when(lot.ends_at)})` : lot.status === "scheduled" ? `opens ${when(lot.starts_at)}` : `closed ${when(lot.ends_at)}`}
          </p>
        </div>
        {next ? (
          <p className="rounded-xl bg-navy-50 p-3 text-sm font-semibold text-navy-900" role="status">
            {next}
          </p>
        ) : null}
        <LotActions lot={lot} />
        <div className="text-xs text-navy-600">
          <p>
            Each bid is at least {lot.rules.step_pct}% above the last, and at least {shopMoney(lot.rules.step_min, lot.currency)} more. A bid in the last{" "}
            {lot.rules.extend_minutes} minutes moves the end to {lot.rules.extend_minutes} minutes after it. The winner has {lot.rules.pay_hours} hours to pay with {payName}.
          </p>
          <Link href="/legal/auctions" className="font-semibold text-brand-700 underline">
            Udozo auctions terms
          </Link>
        </div>
        {lot.recent_bids.length ? (
          <section aria-labelledby="recent-bids">
            <h2 id="recent-bids" className="text-sm font-bold text-navy-900">
              Recent bids
            </h2>
            <ul className="mt-1 grid gap-1 text-sm">
              {lot.recent_bids.map(bid => (
                <li key={`${bid.at}-${bid.amount}`} className="flex justify-between gap-2">
                  <span>{bid.name}</span>
                  <span className="font-semibold">{shopMoney(bid.amount, lot.currency)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
