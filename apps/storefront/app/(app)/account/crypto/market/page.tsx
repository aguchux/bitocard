import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreList, type StoreP2pAd } from "@bitocard/api-client/storefront";
import { card, CoinPicker, CryptoGate, CryptoNav, tradableAssets } from "@/components/app/crypto";
import { PostAdLauncher, TakeAdDialog } from "@/components/app/p2p-dialogs";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "P2P market" };

type Search = { asset?: string; side?: string; currency?: string; q?: string };

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
  const currency = params.currency === "USD" ? "USD" : wallets?.currency ?? "USD";
  const query = (params.q ?? "").trim().slice(0, 80);
  const blocked = !wallets || !wallets.p2p_enabled || wallets.frozen || !wallets.verified;
  const book = blocked ? null : await customerApi<StoreList<StoreP2pAd>>("GET", `/v1/store/p2p/market?${new URLSearchParams({ asset, side, currency, ...(query ? { q: query } : {}) }).toString()}`);
  const shown = book?.ok ? book.data.data : [];
  const href = (next: { asset?: string; side?: string; currency?: string }) => `/account/crypto/market?${new URLSearchParams({ asset, side, currency, ...next }).toString()}`;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-2xl font-extrabold text-navy-900">P2P market</h1>{!blocked && assets.length ? <PostAdLauncher assets={assets} initialAsset={asset} initialSide={side} /> : null}</div>
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
                  className={`flex min-h-11 items-center justify-center rounded-xl text-sm font-bold transition-colors ${side === item ? (item === "buy" ? "bg-emerald-600 text-white shadow-sm" : "bg-brand-500 text-white shadow-sm") : "text-slate-600 hover:bg-white/70 hover:text-navy-900"}`}
                >
                  {item === "buy" ? `Buy ${asset}` : `Sell ${asset}`}
                </Link>
              ))}
            </nav>
          </div>
          <CoinPicker assets={assets} wallets={wallets} current={asset} href={code => href({ asset: code })} label={side === "buy" ? "Coin to buy" : "Coin to sell"} />
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1" aria-label="Fiat currency">
              {[...new Set([wallets!.currency, "USD"])].map(code => <Link key={code} href={href({ currency: code })} aria-current={currency === code ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-lg px-4 text-sm font-semibold ${currency === code ? "bg-white text-navy-900 shadow-sm" : "text-slate-600"}`}>{code}</Link>)}
            </div>
            <form action="/account/crypto/market" className="flex min-w-0 flex-1 gap-2">
              <input type="hidden" name="asset" value={asset} /><input type="hidden" name="side" value={side} /><input type="hidden" name="currency" value={currency} />
              <input type="search" name="q" defaultValue={query} placeholder="Search trader" aria-label="Search trader" className="min-h-10 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm" />
              <button type="submit" className="rounded-xl border border-slate-200 px-4 text-sm font-semibold">Search</button>
            </form>
          </div>
          {shown.length ? (
            <ul className="space-y-3">
              {shown.map(ad => (
                <li key={ad.id} className={card}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 font-semibold">
                        {ad.trader.nickname}
                        {ad.trader.trades_total >= 10 ? <BadgeCheck className="size-4 text-brand-500" aria-label="Experienced trader" /> : null}
                      </p>
                      <p className="text-xs text-slate-500">
                        {ad.trader.trades_30d} {ad.trader.trades_30d === 1 ? "trade" : "trades"} in 30 days · {ad.trader.trades_total} in all
                      </p>
                    </div>
                    <p className="text-right">
                      <span className="block font-display text-xl font-extrabold text-navy-900">{formatFace(ad.price, ad.currency)}</span>
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
                    <TakeAdDialog adId={ad.id} price={ad.price} currency={ad.currency} side={side} min={major(ad.min_fiat)} max={major(ad.max_fiat)} asset={ad.asset} />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className={card}>
              <p className="font-semibold">{query ? "No traders match your search" : side === "buy" ? `Nobody is selling ${asset} for ${currency} right now` : `Nobody is buying ${asset} for ${currency} right now`}</p>
              <p className="mt-1 text-sm text-slate-600">{query ? "Try another trader name or clear the search." : "Post your own ad and other traders can come to you."}</p>
              {!query && assets.length ? <div className="mt-4"><PostAdLauncher assets={assets} initialAsset={asset} initialSide={side} label="Post an ad" /></div> : null}
            </div>
          )}
          <p className="text-xs text-slate-500">Prices are set by traders, not BitoCard. Trades settle at once from your BitoCard wallet; BitoCard&apos;s fee comes out of the crypto received and is shown before you confirm.</p>
        </>
      ) : null}
    </div>
  );
}
