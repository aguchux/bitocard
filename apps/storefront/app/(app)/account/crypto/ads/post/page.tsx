import type { Metadata } from "next";
import Link from "next/link";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreExchange, type StoreList, type StoreP2pMarket } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CryptoGate, tradableAssets } from "@/components/app/crypto";
import { PostAdForm } from "@/components/app/crypto-forms";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Post a P2P ad" };

type Search = { side?: string; asset?: string; currency?: string; market?: string };

/** The ad's amount and limits are reviewed here, away from the market and My ads lists. */
export default async function PostAdPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const [overview, open] = await Promise.all([customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"), customerApi<StoreList<StoreP2pMarket>>("GET", "/v1/store/p2p/markets")]);
  const wallets = overview.ok ? overview.data : null;
  // The market the ad goes in: one the customer may trade in (their own by default), with its currencies.
  const markets = open.ok ? open.data.data : [];
  const chosen = markets.find(item => !item.home && item.market === (params.market ?? "").toUpperCase()) ?? markets.find(item => item.home) ?? markets[0];
  const market = chosen && !chosen.home ? chosen.market : "";
  const currencies = chosen?.currencies ?? [...new Set([wallets?.currency ?? "USD", "USD"])];
  const assets = tradableAssets(wallets);
  const asset = assets.includes((params.asset ?? "").toUpperCase()) ? params.asset!.toUpperCase() : assets[0] ?? "USDT";
  const side = params.side === "sell" ? "sell" : "buy";
  const currency = currencies.includes((params.currency ?? "").toUpperCase()) ? params.currency!.toUpperCase() : currencies[0]!;
  const blocked = !wallets || !chosen || wallets.frozen || !wallets.verified || wallets.declaration?.declared === false || assets.length === 0;
  const reference = blocked ? null : await customerApi<StoreExchange>("GET", `/v1/store/exchange?${new URLSearchParams({ asset, currency })}`);
  const pair = reference?.ok ? reference.data.assets.find(item => item.asset === asset) : null;
  // The desk's buying price includes its configured markup. It is an editable reference for a P2P ad, never a held quote.
  const price = side === "buy" ? pair?.buy?.price : pair?.sell?.price;
  const priceText = price ? String(price / 100) : undefined;
  const coin = wallets?.assets.find(item => item.asset === asset);
  const coinBalance = coin?.available ?? "0";
  const fiatBalance = reference?.ok ? reference.data.balances.proceeds + reference.data.balances.wallet : 0;
  const scale = 10 ** (coin?.decimals ?? 6);
  const buyingAmount = price && fiatBalance > 0 ? Math.floor((fiatBalance / price) * scale) / scale : 0;
  const suggestedAmount = side === "sell" ? Number(coinBalance) > 0 ? coinBalance : undefined : buyingAmount > 0 ? String(buyingAmount) : undefined;
  const suggestedMax = side === "buy" ? fiatBalance > 0 ? String(fiatBalance / 100) : undefined : price && Number(coinBalance) > 0 ? String(Math.floor(Number(coinBalance) * price) / 100) : undefined;
  const route = (next: { asset?: string; side?: string; currency?: string }) => `/account/crypto/ads/post?${new URLSearchParams({ asset, side, currency, ...(market ? { market } : {}), ...next })}`;

  return <div className="mx-auto max-w-3xl space-y-5">
    <Link href="/account/crypto/ads" className="inline-flex min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-navy-900">← My ads</Link>
    <div><h1 className="font-display text-2xl font-extrabold text-navy-900">Post an ad</h1><p className="mt-1 text-sm text-slate-600">Your ad appears on the {market && chosen ? `${chosen.name} ` : ""}P2P market. Filled trades appear in Trades.</p></div>
    {blocked ? assets.length === 0 && chosen ? <p className={card}>No coins are available for new ads right now.</p> : <CryptoGate wallets={wallets} p2p /> : null}
    {!blocked && wallets ? <>
      <section className={card}>
        <div className="flex items-center gap-3"><CoinBadge asset={asset} /><div><p className="font-semibold">{side === "buy" ? "I want to buy" : "I want to sell"} {asset}</p><p className="text-sm text-slate-600">{side === "buy" ? `Pay from your ${currency} balances` : `Receive ${currency} in P2P money`}</p></div></div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <fieldset><legend className="mb-2 text-sm font-semibold">Direction</legend><div className="grid grid-cols-2 gap-2">{(["buy", "sell"] as const).map(value => <Link key={value} href={route({ side: value })} aria-current={side === value ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl border text-sm font-semibold ${side === value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{value === "buy" ? "Buy" : "Sell"}</Link>)}</div></fieldset>
          <fieldset><legend className="mb-2 text-sm font-semibold">{side === "buy" ? "Wallet to debit" : "Fiat to receive"}</legend><div className="grid grid-cols-2 gap-2">{currencies.map(value => <Link key={value} href={route({ currency: value })} aria-current={currency === value ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-xl border text-sm font-semibold ${currency === value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{value}</Link>)}</div></fieldset>
        </div>
        <label className="mt-4 block text-sm font-semibold">Coin<div className="mt-2 flex flex-wrap gap-2">{assets.map(value => <Link key={value} href={route({ asset: value })} aria-current={asset === value ? "page" : undefined} className={`inline-flex min-h-10 items-center rounded-xl border px-3 ${asset === value ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200"}`}>{value}</Link>)}</div></label>
      </section>
      <section className={card}>
        <h2 className="mb-3 text-lg font-bold">Price and limits</h2>
        <p className="mb-4 text-sm text-slate-600">{side === "buy" ? `Available: ${formatFace(fiatBalance, currency)} across your P2P money and ${currency} wallet.` : `Available: ${formatCrypto(coinBalance, asset)} in your coin wallet.`} {price ? `Desk reference: ${formatFace(price, currency)} per ${asset}, including its markup.` : "A live desk reference price is unavailable; enter your own P2P price."}</p>
        <PostAdForm key={`${market}-${side}-${asset}-${currency}`} side={side} asset={asset} currency={currency} market={market} suggestedPrice={priceText} suggestedAmount={suggestedAmount} suggestedMax={suggestedMax} />
      </section>
    </> : null}
  </div>;
}
