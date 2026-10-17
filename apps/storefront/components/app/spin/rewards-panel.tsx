"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRightLeft, Coins, Loader2 } from "lucide-react";
import { formatCrypto, formatPrice, type StoreSpinExchangePreview, type StoreSpinRewardBalance } from "@bitocard/api-client/storefront";
import { exchangeRewards, previewExchange } from "@/lib/spin-actions";
import { usd } from "@/lib/spin";
import { CoinToken } from "./coin-token";
import styles from "./spin.module.css";

/**
 * The customer's rewards and the way to use them: never withdrawn or traded, they are exchanged into the store wallet
 * (their country's currency or US dollars) to buy from the store. The amount is quoted first; exchanging refuses a
 * lower amount than the one shown.
 */
export function RewardsPanel({ rewards, onExchanged }: { rewards: StoreSpinRewardBalance; onExchanged: () => void }) {
  const currencies = rewards.exchange_currencies;
  const [quote, setQuote] = useState<StoreSpinExchangePreview | null>(null);
  const [state, setState] = useState<"idle" | "quoting" | "exchanging">("idle");
  const [message, setMessage] = useState<{ tone: "error" | "done"; text: string } | null>(null);
  const has = Number(rewards.usd) > 0;

  async function quoteFor(code: string) {
    setMessage(null);
    setState("quoting");
    const result = await previewExchange(code);
    setState("idle");
    if (result.ok) setQuote(result.data);
    else {
      setQuote(null);
      setMessage({ tone: "error", text: result.message });
    }
  }

  async function exchange() {
    if (!quote) return;
    setState("exchanging");
    const result = await exchangeRewards(quote.currency, quote.amount, crypto.randomUUID());
    setState("idle");
    setQuote(null);
    if (result.ok) {
      setMessage({ tone: "done", text: `${formatPrice(result.data.amount, result.data.currency)} is in your wallet. Spend it on anything in the store.` });
      onExchanged();
    } else setMessage({ tone: "error", text: result.message });
  }

  return (
    <section aria-labelledby="rewards" className={`${styles.goldPanel} p-5 sm:p-6`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="rewards" className="flex items-center gap-2 text-lg font-bold">
            <Coins className="size-5 text-gold-400" aria-hidden="true" />
            Your rewards
          </h2>
          <p className="mt-1 text-sm text-white/65">Move them into your wallet and spend them in the store. Rewards cannot be withdrawn or sent anywhere else.</p>
        </div>
        <span className={`shrink-0 font-display text-3xl font-black tabular-nums ${styles.goldText}`}>{usd(rewards.usd)}</span>
      </div>

      {rewards.coins.length ? (
        <ul className="mt-4 flex flex-wrap gap-2 text-sm" aria-label="Rewards by coin">
          {rewards.coins.map(coin => (
            <li key={coin.asset} className="inline-flex items-center gap-2 rounded-full bg-white/8 py-1 pr-3 pl-1 ring-1 ring-white/10">
              <CoinToken asset={coin.asset} size="sm" />
              {formatCrypto(coin.amount, coin.asset)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-white/65">What you win collects here.</p>
      )}

      {has ? (
        <div className="mt-5 space-y-3">
          <div role="group" aria-label="Wallet to move them to" className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-black/25 p-1 ring-1 ring-white/10">
            {currencies.map(code => (
              <button
                key={code}
                type="button"
                onClick={() => quoteFor(code)}
                disabled={state !== "idle"}
                aria-pressed={quote?.currency === code}
                className={`min-h-11 rounded-xl px-3 text-sm font-bold transition-colors ${quote?.currency === code ? "bg-white text-navy-900 shadow-sm" : "text-white/80 hover:bg-white/10 hover:text-white"}`}
              >
                {code === "USD" ? "US dollars" : `${code} wallet`}
              </button>
            ))}
          </div>
          {state === "quoting" ? (
            <p className="flex items-center gap-2 text-sm text-white/70">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Working out the rate…
            </p>
          ) : null}
          {quote ? (
            <div className="rounded-2xl bg-white p-4 text-navy-900 shadow-lg">
              <div className="flex items-end justify-between gap-3 border-b border-dashed border-slate-200 pb-3">
                <div>
                  <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">You get</p>
                  <p className="font-display text-3xl font-black tabular-nums">{formatPrice(quote.amount, quote.currency)}</p>
                </div>
                <p className="text-right text-xs text-slate-500">
                  {usd(quote.usd)}
                  {quote.currency === "USD" ? "" : ` at ${Number(quote.rate).toLocaleString("en-GB", { maximumFractionDigits: 2 })} ${quote.currency} to the dollar`}
                </p>
              </div>
              <button
                type="button"
                onClick={exchange}
                disabled={state !== "idle"}
                className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 font-bold text-white hover:bg-brand-600 disabled:opacity-70"
              >
                {state === "exchanging" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ArrowRightLeft className="size-4" aria-hidden="true" />}
                Move to my wallet
              </button>
            </div>
          ) : state === "idle" && !message ? (
            <p className="text-sm text-white/65">Choose a wallet to see what you get.</p>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-2xl p-3 text-sm ${message.tone === "error" ? "bg-red-500/15 text-red-100 ring-1 ring-red-400/40" : "bg-emerald-500/15 text-emerald-100 ring-1 ring-emerald-400/40"}`}>
          {message.text}
          {message.tone === "done" ? (
            <Link href="/account/wallet" className="ml-1 font-semibold underline">
              See my wallet
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
