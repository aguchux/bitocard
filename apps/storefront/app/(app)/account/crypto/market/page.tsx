import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreList, type StoreP2pAd } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoGate, CryptoNav, tradableAssets } from "@/components/app/crypto";
import { TakeAdForm } from "@/components/app/crypto-forms";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "P2P market" };

type Search = { asset?: string; side?: string };

const major = (minor: number) => (minor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** The order book: to buy, sellers cheapest first; to sell, buyers paying most first. Each ad is taken in two steps. */
export default async function MarketPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const overview = await customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto");
  const wallets = overview.ok ? overview.data : null;
  const assets = tradableAssets(wallets);
  const asked = (params.asset ?? "").toUpperCase();
  const asset = assets.includes(asked) ? asked : (assets[0] ?? "USDT");
  const side = params.side === "sell" ? "sell" : "buy";
  const blocked = !wallets || !wallets.p2p_enabled || wallets.frozen || !wallets.verified;
  const book = blocked ? null : await customerApi<StoreList<StoreP2pAd>>("GET", `/v1/store/p2p/market?${new URLSearchParams({ asset, side }).toString()}`);
  const href = (next: { asset?: string; side?: string }) => `/account/crypto/market?${new URLSearchParams({ asset, side, ...next }).toString()}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="font-display text-2xl font-extrabold text-[#070f4c]">P2P market</h1>
      <CryptoNav current="/account/crypto/market" />
      {blocked ? <CryptoGate wallets={wallets} p2p /> : null}
      {!blocked ? (
        <>
          <div className="space-y-3">
            <nav aria-label="Buy or sell" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1">
              {(["buy", "sell"] as const).map(item => (
                <Link
                  key={item}
                  href={href({ side: item })}
                  aria-current={side === item ? "page" : undefined}
                  className={`flex min-h-11 items-center justify-center rounded-xl text-sm font-bold ${side === item ? (item === "buy" ? "bg-emerald-600 text-white" : "bg-[#ff2382] text-white") : "text-slate-600"}`}
                >
                  {item === "buy" ? `Buy ${asset}` : `Sell ${asset}`}
                </Link>
              ))}
            </nav>
            <nav aria-label="Coin" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
              {assets.map(code => (
                <Link
                  key={code}
                  href={href({ asset: code })}
                  aria-current={code === asset ? "page" : undefined}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full bg-white pr-3 pl-1 text-sm font-semibold ring-1 ring-slate-200 aria-[current=page]:ring-2 aria-[current=page]:ring-[#070f4c]"
                >
                  <CoinBadge asset={code} size="size-8" /> {code}
                </Link>
              ))}
            </nav>
          </div>
          {book?.ok && book.data.data.length ? (
            <ul className="space-y-3">
              {book.data.data.map(ad => (
                <li key={ad.id} className={card}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold">
                        {ad.trader.nickname}
                        {ad.trader.trades_total >= 10 ? <BadgeCheck className="size-4 text-[#ff2382]" aria-label="Experienced trader" /> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ad.trader.trades_30d} {ad.trader.trades_30d === 1 ? "trade" : "trades"} in 30 days · {ad.trader.trades_total} in all
                      </p>
                    </div>
                    <p className="text-right">
                      <span className="block font-display text-xl font-extrabold text-[#070f4c]">{formatFace(ad.price, ad.currency)}</span>
                      <span className="block text-xs text-slate-500">per {ad.asset}</span>
                    </p>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div className="min-w-0">
                      <dt className="text-xs text-slate-500">{side === "buy" ? "Available" : "Wants"}</dt>
                      <dd className="truncate font-semibold">{formatCrypto(ad.available, ad.asset)}</dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-slate-500">Per trade</dt>
                      <dd className="font-semibold">
                        {formatFace(ad.min_fiat, ad.currency)} – {formatFace(ad.max_fiat, ad.currency)}
                      </dd>
                    </div>
                  </dl>
                  {ad.terms ? <p className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-sm break-words text-slate-600">{ad.terms}</p> : null}
                  <div className="mt-3">
                    <TakeAdForm adId={ad.id} price={ad.price} currency={ad.currency} side={side} min={major(ad.min_fiat)} max={major(ad.max_fiat)} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={card}>
              <p className="font-semibold">{side === "buy" ? `Nobody is selling ${asset} right now` : `Nobody is buying ${asset} right now`}</p>
              <p className="mt-1 text-sm text-slate-600">Post your own ad and other traders come to you.</p>
              <Link href="/account/crypto/ads" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
                Post an ad
              </Link>
            </div>
          )}
          <p className="text-xs text-slate-500">Prices are set by traders, not BitoCard. Trades settle at once from your BitoCard wallet; BitoCard&apos;s fee comes out of the crypto received and is shown before you confirm.</p>
        </>
      ) : null}
    </div>
  );
}
