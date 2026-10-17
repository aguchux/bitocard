"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDownUp, CircleAlert, CircleCheck, Clock3, X } from "lucide-react";
import { formatCrypto, formatFace, type StoreExchangeAsset, type StoreExchangeQuote, type StoreExchangeTrade } from "@bitocard/api-client/storefront";
import { CoinBadge } from "@/components/app/crypto";
import { quoteExchange, tradeExchange } from "@/lib/exchange-actions";
import { availabilityText, changeText, fiatText, maximum, parseCoin, parseFiat, percent, problem, type Side, terms, type Unit, units, usdText } from "@/lib/exchange";

type Props = {
  pair: StoreExchangeAsset;
  side: Side;
  currency: string;
  desk: string;
  balances: { proceeds: number; wallet: number };
  quoteSeconds: number;
  /** Money to start from (minor units), when another screen sent the customer here with an amount. */
  initialFiat?: number | null;
};

/**
 * The directional trade sheet: one editable amount (money or coins, the customer's choice), the other calculated,
 * with the limit BitoCard's reserve sets shown right under what is typed, where the money comes from or goes, and the
 * desk's price beside the market price. Review asks the API for a quote held for 30 seconds.
 */
export function ExchangeSheet({ pair, side, currency, desk, balances, quoteSeconds, initialFiat = null }: Props) {
  const id = useId();
  const sideTerms = side === "buy" ? pair.buy : pair.sell;
  const [unit, setUnit] = useState<Unit>(initialFiat || side === "buy" ? "fiat" : "coin");
  const [text, setText] = useState(initialFiat ? fiatText(BigInt(initialFiat)) : "");
  const [reviewing, setReviewing] = useState(false);
  const [quote, setQuote] = useState<StoreExchangeQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const have = useMemo(() => ({ money: BigInt(balances.proceeds + balances.wallet), coins: parseCoin(pair.holding, pair.decimals) ?? 0n }), [balances, pair]);
  const typed = unit === "fiat" ? parseFiat(text) : parseCoin(text, pair.decimals);
  const trade = sideTerms && typed !== null && typed > 0n ? terms(side, BigInt(sideTerms.price), pair.decimals, unit === "fiat" ? { fiat: typed } : { amount: typed }) : null;
  const most = sideTerms ? maximum(side, sideTerms, pair.decimals, have) : null;
  const issue = sideTerms && trade ? problem(side, sideTerms, pair, trade, have) : null;
  const coin = pair.asset;

  if (!sideTerms) {
    return (
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm" aria-labelledby={`${id}-closed`}>
        <p id={`${id}-closed`} className="flex items-center gap-2 font-semibold text-navy-900">
          <CircleAlert className="size-5 text-amber-600" aria-hidden="true" />
          {pair.closed === "price_unavailable"
            ? `${coin} prices are unavailable right now.`
            : pair.closed === "conversion_unavailable"
              ? `Prices in ${currency} are paused right now.`
              : `${desk} does not ${side === "buy" ? "sell" : "buy"} ${coin} here right now.`}
        </p>
        <p className="mt-1 text-sm text-slate-600">
          {pair.closed === "not_offered" ? "Try another coin, or trade with other people on the P2P market." : "Try again in a minute. We never trade on an old price."}
        </p>
        <Link href={`/account/crypto/market?asset=${coin}&side=${side}`} className="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 font-semibold text-navy-900 ring-1 ring-slate-300 hover:ring-slate-400 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700">
          Go to the P2P market
        </Link>
      </section>
    );
  }

  const enteredMax = most ? (unit === "fiat" ? most.fiat : most.amount) : 0n;
  const useMax = () => {
    if (most) setText(unit === "fiat" ? fiatText(most.fiat) : units(most.amount, pair.decimals));
  };
  const switchUnit = () => {
    // Keep the trade the same: what was calculated becomes what is typed.
    if (trade) setText(unit === "fiat" ? units(trade.amount, pair.decimals) : fiatText(trade.fiat));
    setUnit(unit === "fiat" ? "coin" : "fiat");
  };

  const limitLine =
    side === "buy"
      ? unit === "coin"
        ? `Up to ${formatCrypto(sideTerms.available_amount, coin)} available from ${desk}`
        : `${desk} can sell up to ${formatFace(sideTerms.available_fiat, currency)} of ${coin}`
      : unit === "fiat"
        ? `${desk} can pay up to ${formatFace(sideTerms.available_fiat, currency)}`
        : `${desk} can buy up to ${formatCrypto(sideTerms.available_amount, coin)}`;

  const issueText = issue
    ? {
        small: "This amount is too small to trade.",
        reserve: side === "buy" ? `${desk} has ${formatCrypto(sideTerms.available_amount, coin)} available.` : `${desk} can pay up to ${formatFace(sideTerms.available_fiat, currency)} right now.`,
        money: `Your ${currency} balance is ${formatFace(Number(have.money), currency)}.`,
        coins: `You have ${formatCrypto(pair.holding, coin)}.`,
        below: `The smallest trade is ${formatFace(sideTerms.min_fiat, currency)}.`,
        above: `The largest trade is ${formatFace(sideTerms.max_fiat ?? 0, currency)}.`,
      }[issue.kind]
    : null;

  const review = async () => {
    if (!trade || issue) return;
    setBusy(true);
    setError(null);
    const result = await quoteExchange({ asset: coin, side, ...(unit === "fiat" ? { fiat: Number(trade.fiat) } : { amount: units(trade.amount, pair.decimals) }) });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setQuote(result.data);
    setReviewing(true);
  };

  const label = unit === "fiat" ? (side === "buy" ? "You pay" : "You receive") : side === "buy" ? "You receive" : "You sell";
  const outLabel = unit === "fiat" ? (side === "buy" ? "You receive" : "You sell") : side === "buy" ? "You pay" : "You receive";
  const outValue = trade ? (unit === "fiat" ? formatCrypto(units(trade.amount, pair.decimals), coin) : formatFace(Number(trade.fiat), currency)) : unit === "fiat" ? `0 ${coin}` : formatFace(0, currency);

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:p-6">
      <h2 id={`${id}-title`} className="sr-only">
        {side === "buy" ? `Buy ${coin}` : `Sell ${coin}`}
      </h2>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-amount`} className="text-sm font-semibold text-slate-700">
          {label}
        </label>
        <button type="button" onClick={switchUnit} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-600 hover:bg-brand-50 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700">
          <ArrowDownUp className="size-4" aria-hidden="true" />
          {unit === "fiat" ? `Enter ${coin} amount` : `Enter ${currency} amount`}
        </button>
      </div>
      <div className="mt-1 flex items-baseline gap-2 border-b-2 border-slate-200 pb-2 focus-within:border-brand-500">
        <span className="font-display text-2xl font-bold text-slate-400" aria-hidden="true">
          {unit === "fiat" ? currency : coin}
        </span>
        <input
          id={`${id}-amount`}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          onChange={event => setText(event.target.value)}
          placeholder="0"
          aria-describedby={`${id}-limit ${id}-issue`}
          aria-invalid={issue ? true : undefined}
          className="min-w-0 flex-1 bg-transparent font-display text-4xl font-extrabold text-navy-900 tabular-nums placeholder:text-slate-300 focus:outline-none sm:text-5xl"
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm" aria-live="polite">
        <p id={`${id}-limit`} className="text-slate-600">
          {limitLine}
        </p>
        <button type="button" onClick={useMax} disabled={!most || enteredMax <= 0n} className="min-h-11 rounded-xl px-3 font-semibold text-brand-600 hover:bg-brand-50 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700 disabled:opacity-40">
          Max
        </button>
      </div>
      {issueText ? (
        <div id={`${id}-issue`} className="mt-2 flex flex-wrap items-center gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900 ring-1 ring-amber-200/70" role="status">
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{issueText}</span>
          {issue?.kind === "reserve" || issue?.kind === "coins" || issue?.kind === "above" ? (
            <button type="button" onClick={useMax} className="min-h-11 rounded-xl px-3 font-semibold underline-offset-2 hover:underline">
              Use available amount
            </button>
          ) : null}
          {issue?.kind === "money" ? (
            <Link href="/account/wallet" className="inline-flex min-h-11 items-center rounded-xl px-3 font-semibold underline-offset-2 hover:underline">
              Add funds
            </Link>
          ) : null}
        </div>
      ) : null}

      <dl className="mt-5 divide-y divide-slate-100 text-sm">
        <div className="flex items-baseline justify-between gap-4 pb-3">
          <dt className="text-slate-600">{outLabel}</dt>
          <dd className="min-w-0 text-right font-display text-xl font-extrabold break-all text-navy-900 tabular-nums" aria-live="polite">
            {outValue}
          </dd>
        </div>
        <div className="flex items-start justify-between gap-4 py-3">
          <dt className="text-slate-600">{side === "buy" ? "Paid from" : "Money goes to"}</dt>
          <dd className="min-w-0 text-right text-navy-900">
            {side === "buy" ? (
              <>
                P2P money first, then your {currency} wallet
                <span className="block text-xs text-slate-500">
                  P2P money {formatFace(balances.proceeds, currency)} · Wallet {formatFace(balances.wallet, currency)}
                </span>
              </>
            ) : (
              <>
                Your P2P money
                <span className="block text-xs text-slate-500">You hold {formatCrypto(pair.holding, coin)} · cash out where available</span>
              </>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-3">
          <dt className="text-slate-600">
            {desk} {side === "buy" ? "sells at" : "buys at"}
          </dt>
          <dd className="min-w-0 text-right font-semibold break-words text-navy-900 tabular-nums">
            {formatFace(sideTerms.price, currency)} / {coin}
          </dd>
        </div>
        {pair.market ? (
          <div className="flex items-baseline justify-between gap-4 pt-3">
            <dt className="text-slate-600">Market price</dt>
            <dd className="text-right text-slate-700 tabular-nums">
              {usdText(pair.market.usd)}
              {pair.market.change_24h !== null ? <span className={pair.market.change_24h >= 0 ? "text-emerald-700" : "text-red-700"}> · {changeText(pair.market.change_24h)} 24h</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="mt-2 text-xs text-slate-500">
        {desk}&apos;s price is the live market price {side === "buy" ? "plus" : "less"} its {percent(sideTerms.markup_bps)} markup.
      </p>

      {error ? (
        <p className="mt-4 flex gap-2 rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-200" role="alert">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void review()}
        disabled={!trade || Boolean(issue) || busy}
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700 disabled:opacity-50"
      >
        {busy ? "Getting your quote…" : side === "buy" ? "Review buy" : "Review sale"}
      </button>

      {reviewing && quote ? (
        <ReviewDialog
          quote={quote}
          desk={desk}
          seconds={quoteSeconds}
          onRequote={async () => {
            const fresh = await quoteExchange({ asset: coin, side, ...(unit === "fiat" ? { fiat: quote.fiat } : { amount: quote.amount }) });
            if (fresh.ok) setQuote(fresh.data);
            return fresh.ok ? null : fresh.message;
          }}
          onClose={() => {
            setReviewing(false);
            setQuote(null);
          }}
          onTraded={() => setText("")}
        />
      ) : null}
    </section>
  );
}

/**
 * The review: a statement of the held quote with a text countdown ("Price held for 0:28"), the confirm button naming
 * the outcome, a new quote once it runs out, the API's refusal (the reserve changed) and then the receipt.
 */
function ReviewDialog({ quote, desk, seconds, onRequote, onClose, onTraded }: { quote: StoreExchangeQuote; desk: string; seconds: number; onRequote: () => Promise<string | null>; onClose: () => void; onTraded: () => void }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const remaining = () => Math.max(0, Math.min(seconds, Math.ceil((Date.parse(quote.expires_at) - Date.now()) / 1000)));
  const [left, setLeft] = useState(remaining);
  const [nonce, setNonce] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<StoreExchangeTrade | null>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Show the server's actual expiry, including time spent delivering the quote to this screen.
  useEffect(() => {
    const update = () => setLeft(Math.max(0, Math.min(seconds, Math.ceil((Date.parse(quote.expires_at) - Date.now()) / 1000))));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [quote.expires_at, seconds]);

  const buying = quote.side === "buy";
  const coins = formatCrypto(quote.amount, quote.asset);
  const money = formatFace(quote.fiat, quote.currency);
  const expired = left <= 0;
  const availability = availabilityText(quote, desk);

  const close = () => {
    ref.current?.close();
    if (done) router.refresh();
    onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await tradeExchange(quote.id, nonce);
    setBusy(false);
    if (result.ok) {
      setDone(result.data);
      onTraded();
      return;
    }
    // A refused trade moved nothing: a new attempt is a new request.
    setNonce(crypto.randomUUID());
    setError(result.code === "reserve_insufficient" ? `The trade did not happen. ${result.message}` : result.message);
    if (result.code === "reserve_insufficient") router.refresh();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="exchange-review-title"
      onClose={onClose}
      onCancel={event => {
        event.preventDefault();
        close();
      }}
      className="m-auto w-[min(28rem,calc(100vw-1.5rem))] rounded-2xl bg-white p-0 text-navy-900 shadow-2xl backdrop:bg-navy-900/50"
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 id="exchange-review-title" className="font-display text-lg font-extrabold">
            {done ? (buying ? "Bought" : "Sold") : buying ? `Buy ${quote.asset}` : `Sell ${quote.asset}`}
          </h2>
          <p className="text-sm text-slate-500">
            With {desk}
            {quote.mode === "test" ? " · test" : ""}
          </p>
        </div>
        <button type="button" onClick={close} aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100">
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <div className="space-y-4 px-5 py-5">
        {done ? (
          <p className="flex items-center gap-2 rounded-2xl bg-emerald-50 px-3 py-3 font-semibold text-emerald-900 ring-1 ring-emerald-200" role="status">
            <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
            {buying ? `${coins} is in your wallet.` : `${money} is in your P2P money.`}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <CoinBadge asset={quote.asset} size="size-12" />
          <dl className="min-w-0 flex-1 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">{buying ? "You pay" : "You sell"}</dt>
              <dd className="min-w-0 text-right font-display text-lg font-extrabold break-all tabular-nums">{buying ? money : coins}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-slate-500">You receive</dt>
              <dd className="min-w-0 text-right font-display text-lg font-extrabold break-all tabular-nums">{buying ? coins : money}</dd>
            </div>
          </dl>
        </div>
        <dl className="divide-y divide-slate-100 rounded-2xl bg-slate-50 px-4 text-sm">
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-slate-500">{desk}&apos;s price</dt>
            <dd className="min-w-0 text-right font-semibold break-words tabular-nums">
              {formatFace(quote.price, quote.currency)} / {quote.asset}
            </dd>
          </div>
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-slate-500">Market price</dt>
            <dd className="tabular-nums">{usdText(quote.market_usd)}</dd>
          </div>
          <div className="flex justify-between gap-3 py-2.5">
            <dt className="text-slate-500">{buying ? "Paid from" : "Paid into"}</dt>
            <dd className="text-right">{buying ? `P2P money, then your ${quote.currency} wallet` : "Your P2P money"}</dd>
          </div>
          {done ? (
            <div className="flex justify-between gap-3 py-2.5">
              <dt className="text-slate-500">Trade</dt>
              <dd className="text-right">
                {done.number} · {new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(done.created_at))}
              </dd>
            </div>
          ) : null}
        </dl>

        {!done ? (
          <div className="text-sm">
            <p className="text-slate-600">{availability.line}</p>
            {availability.capped ? (
              <p className="mt-2 flex gap-2 rounded-2xl bg-amber-50 px-3 py-2.5 text-amber-900 ring-1 ring-amber-200/70">
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {availability.capped}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <p className="flex gap-2 rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-200" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        ) : null}

        {done ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <button type="button" onClick={close} className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700">
              Back to Exchange
            </button>
            <Link href="/account/crypto" className="inline-flex min-h-12 flex-1 items-center justify-center rounded-xl px-5 font-semibold text-navy-900 ring-1 ring-slate-300">
              See my coins
            </Link>
          </div>
        ) : (
          <>
            <p className={`flex items-center gap-2 text-sm font-semibold ${expired ? "text-amber-700" : "text-slate-600"}`} aria-live="polite">
              <Clock3 className="size-4" aria-hidden="true" />
              {expired ? "This price is no longer held." : `Price held for 0:${String(left).padStart(2, "0")}`}
            </p>
            {expired ? (
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(await onRequote());
                  setNonce(crypto.randomUUID());
                  setBusy(false);
                }}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700 disabled:opacity-50"
              >
                {busy ? "Getting a new quote…" : "Get a new quote"}
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirm()}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-brand-500 px-5 font-semibold text-white hover:bg-brand-600 focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700 disabled:opacity-50"
              >
                {busy ? "Trading…" : buying ? `Buy ${coins}` : `Sell ${coins}`}
              </button>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
