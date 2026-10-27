import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { formatCrypto, formatFace, type StoreCryptoWallets, type StoreExchange, type StoreExchangeTrade, type StoreList } from "@bitocard/api-client/storefront";
import { card, CoinBadge, CoinPicker, CryptoGate, CryptoNav, date } from "@/components/app/crypto";
import { ExchangeSheet } from "@/components/app/exchange/exchange-sheet";
import { customerApi } from "@/lib/customer";
import { changeText, fiatParam, usdText } from "@/lib/exchange";

export const metadata: Metadata = { title: "Exchange" };

type Search = { asset?: string; side?: string; fiat?: string };

/** Gates the crypto pages share (identity check, frozen account, crypto closed) say why first. */
const cryptoBlocks = new Set(["crypto_not_enabled", "customer_verification_required", "crypto_account_frozen", "email_not_verified"]);

/**
 * The instant exchange: buy coins with the money wallet or sell them for P2P money, straight from BitoCard's reserves
 * at the live market price plus BitoCard's markup. Buy or Sell first, then the coin, then the trade sheet; desktops get
 * a narrow rail of facts beside it (the reserve, balances, the market), and the latest exchange trades below.
 */
export default async function ExchangePage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const [overview, wallets, trades] = await Promise.all([
    customerApi<StoreExchange>("GET", "/v1/store/exchange"),
    customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"),
    customerApi<StoreList<StoreExchangeTrade>>("GET", "/v1/store/exchange/trades?limit=5"),
  ]);
  const exchange = overview.ok ? overview.data : null;
  const side = params.side === "sell" ? "sell" : "buy";
  const codes = exchange?.assets.map(item => item.asset) ?? [];
  const asked = (params.asset ?? "").toUpperCase();
  const open = exchange?.assets.filter(item => (side === "buy" ? item.buy : item.sell)) ?? [];
  const asset = codes.includes(asked) ? asked : (open[0]?.asset ?? codes[0] ?? "USDT");
  const pair = exchange?.assets.find(item => item.asset === asset) ?? null;
  const sideTerms = pair ? (side === "buy" ? pair.buy : pair.sell) : null;
  // Switching side or coin starts afresh: the amount sent here (`?fiat=`, from Quick buy or sell) is for this pair only.
  const href = (next: { asset?: string; side?: string }) => `/account/crypto/exchange?${new URLSearchParams({ asset, side, ...next }).toString()}`;
  const fiat = fiatParam(params.fiat);
  const initialFiat = fiat === null ? null : Number(fiat);
  const desk = pair?.desk.name ?? exchange?.desk.name ?? "BitoCard";

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-extrabold text-navy-900">Exchange{exchange?.mode === "test" ? " (test)" : ""}</h1>
        <p className="text-sm text-slate-600">Trading with {desk}, at the live market price.</p>
      </div>
      <CryptoNav current="/account/crypto/exchange" />

      {!exchange ? <p className={card}>The exchange cannot be shown right now. Try again shortly.</p> : null}
      {exchange && !exchange.enabled ? (
        cryptoBlocks.has(exchange.reason ?? "") && wallets.ok ? (
          <CryptoGate wallets={wallets.data} />
        ) : (
          <div className={card}>
            <p className="font-semibold">{exchange.message ?? "The instant exchange is not available here yet."}</p>
            <p className="mt-1 text-sm text-slate-600">You can still trade with other people on the P2P market where it is open.</p>
            <Link href="/account/crypto" className="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-navy-900 ring-1 ring-slate-300 hover:ring-slate-400">
              Go to the P2P market
            </Link>
          </div>
        )
      ) : null}

      {exchange?.enabled && pair ? (
        <>
          <nav aria-label="Buy or sell" className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1 lg:max-w-xl">
            {(["buy", "sell"] as const).map(item => (
              <Link
                key={item}
                href={href({ side: item })}
                aria-current={side === item ? "page" : undefined}
                className={`flex min-h-11 items-center justify-center rounded-xl text-sm font-bold transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${side === item ? "bg-brand-50 text-brand-700 shadow-sm ring-1 ring-brand-200" : "text-slate-600 hover:bg-white/70 hover:text-navy-900"}`}
              >
                {item === "buy" ? "Buy" : "Sell"}
              </Link>
            ))}
          </nav>
          <CoinPicker assets={codes} wallets={wallets.ok ? wallets.data : null} current={asset} href={code => href({ asset: code })} label={side === "buy" ? "Coin to buy" : "Coin to sell"} />

          <div className="grid gap-5 lg:grid-cols-[minmax(0,36rem)_minmax(0,1fr)] lg:items-start">
            <ExchangeSheet key={`${asset}-${side}-${initialFiat ?? ""}`} initialFiat={initialFiat} pair={pair} side={side} currency={exchange.currency} desk={desk} balances={exchange.balances} quoteSeconds={exchange.quote_seconds} />

            <aside aria-label={`${desk} and the market`} className="space-y-3 text-sm lg:sticky lg:top-24">
              <section className={card}>
                <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">{desk}&apos;s reserve</h2>
                {sideTerms ? (
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">{side === "buy" ? "Coins to sell you" : "Money to pay you"}</dt>
                      <dd className="text-right font-semibold tabular-nums">{side === "buy" ? formatCrypto(sideTerms.available_amount, asset) : formatFace(sideTerms.available_fiat, exchange.currency)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-slate-600">Per trade</dt>
                      <dd className="text-right tabular-nums">
                        {formatFace(sideTerms.min_fiat, exchange.currency)} – {sideTerms.max_fiat === null ? "no maximum" : formatFace(sideTerms.max_fiat, exchange.currency)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-slate-600">Closed for {asset} right now.</p>
                )}
              </section>
              <section className={card}>
                <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">Your balances</h2>
                <dl className="mt-2 space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">P2P money</dt>
                    <dd className="font-semibold tabular-nums">{formatFace(exchange.balances.proceeds, exchange.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">{exchange.currency} wallet</dt>
                    <dd className="font-semibold tabular-nums">{formatFace(exchange.balances.wallet, exchange.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-slate-600">{asset}</dt>
                    <dd className="font-semibold tabular-nums">{formatCrypto(pair.holding, asset)}</dd>
                  </div>
                </dl>
              </section>
              {pair.market ? (
                <section className={card}>
                  <h2 className="text-xs font-bold tracking-wider text-slate-500 uppercase">{asset} market</h2>
                  <p className="mt-2 font-display text-xl font-extrabold text-navy-900 tabular-nums">{usdText(pair.market.usd)}</p>
                  <p className="text-slate-600">
                    {pair.market.change_24h !== null ? <span className={pair.market.change_24h >= 0 ? "text-emerald-700" : "text-red-700"}>{changeText(pair.market.change_24h)} in 24 hours</span> : null}
                    {pair.market.updated_at ? <span className="block text-xs text-slate-500">Updated {date(pair.market.updated_at)}</span> : null}
                  </p>
                </section>
              ) : null}
              <Link href={`/account/crypto?asset=${asset}&side=${side}`} className="flex min-h-11 items-center gap-2 rounded-2xl px-4 font-semibold text-navy-900 ring-1 ring-slate-200 hover:ring-slate-300">
                <ArrowLeftRight className="size-4" aria-hidden="true" /> Bigger amount? Try the P2P market
              </Link>
            </aside>
          </div>
        </>
      ) : null}
      {/* Shown whatever the exchange says now: a trade notification links here, and past trades stay visible. */}
      {trades.ok && trades.data.data.length ? (
        <section aria-labelledby="exchange-trades" className={card}>
          <h2 id="exchange-trades" className="mb-1 text-lg font-bold">
            Your exchange trades
          </h2>
          <ul className="divide-y divide-slate-100">
            {trades.data.data.map(trade => (
              <li key={trade.id} className="flex items-center gap-3 py-3">
                <CoinBadge asset={trade.asset} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">
                    {trade.side === "buy" ? "Bought" : "Sold"} {formatCrypto(trade.amount, trade.asset)}
                  </span>
                  <span className="block truncate text-sm text-slate-500">
                    {trade.number} · with {trade.desk.name} · {date(trade.created_at)}
                  </span>
                </span>
                <span className={`shrink-0 font-semibold tabular-nums ${trade.side === "buy" ? "text-navy-900" : "text-emerald-700"}`}>
                  {trade.side === "buy" ? "−" : "+"}
                  {formatFace(trade.fiat, trade.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
