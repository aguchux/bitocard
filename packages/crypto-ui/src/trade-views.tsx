import type { ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { formatCrypto, formatFace, type StoreP2pAd, type StoreP2pQuote, type StoreP2pTrade } from "@bitocard/api-client/storefront";
import { CoinBadge } from "./coins";

/** A card on the crypto pages. */
export const cardClass = "rounded-3xl bg-white p-5 ring-1 ring-slate-200/70";

/**
 * The declaration every account makes before trading: not a citizen or resident of the United States or the United
 * Kingdom. `action` is the app's server action recording it (`POST /v1/store/crypto/declaration { version }`).
 */
export function CryptoDeclaration({ version, action }: { version: string; action: (form: FormData) => Promise<void> }) {
  return (
    <form action={action} className={cardClass}>
      <p className="flex items-center gap-2 font-semibold">
        <ShieldCheck className="size-5 text-brand-500" aria-hidden="true" /> One question before you trade
      </p>
      <p className="mt-1 text-sm text-slate-600">Crypto trading is open only to residents of the countries we serve.</p>
      <input type="hidden" name="version" value={version} />
      <label className="mt-4 flex items-start gap-3 text-sm font-medium text-navy-900">
        <input type="checkbox" name="confirm" value="yes" required className="mt-0.5 size-5 shrink-0 accent-brand-500" />
        I am not a citizen or a resident of the United States or the United Kingdom.
      </label>
      <button type="submit" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 font-semibold text-white hover:bg-brand-600">
        Confirm and continue
      </button>
    </form>
  );
}

export const tradeDate = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

/**
 * The trade the customer is about to make, exactly: price, what they pay or receive, BitoCard's fee and the coins that
 * arrive. `children` is the confirm form; nothing moves until they confirm, and a changed price is refused, never charged.
 */
export function QuoteDetails({ quote, children }: { quote: StoreP2pQuote; children?: ReactNode }) {
  const buying = quote.side !== "sell";
  const rows: Array<[string, string, boolean?]> = [
    ["Price", `${formatFace(quote.price, quote.currency)} / ${quote.asset}`],
    [buying ? "You pay" : "You receive", formatFace(quote.fiat, quote.currency)],
    ["BitoCard fee", formatCrypto(quote.fee, quote.asset)],
    [buying ? "Coins you receive" : "The buyer receives", formatCrypto(quote.received, quote.asset), true],
  ];
  return (
    <section className={cardClass} aria-label="Trade details">
      <div className="flex items-center gap-3">
        <CoinBadge asset={quote.asset} size="size-12" />
        <div>
          <p className="text-sm text-slate-500">{buying ? "You buy" : "You sell"}</p>
          <p className="font-display text-2xl font-extrabold">{formatCrypto(quote.amount, quote.asset)}</p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-slate-100 text-sm">
        {rows.map(([label, value, strong]) => (
          <div key={label} className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">{label}</dt>
            <dd className={strong ? "font-bold text-emerald-700" : "font-semibold"}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex items-start gap-2 rounded-2xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />
        {buying ? "Paid from your balance in this currency. " : "The money goes to your fiat balance at once. "}
        Settled instantly by BitoCard: the coins and the money move together in one step, or not at all.
      </p>
      {children ? <div className="mt-4">{children}</div> : null}
    </section>
  );
}

/** A completed trade's receipt, from the viewer's side. */
export function TradeReceipt({ trade }: { trade: StoreP2pTrade }) {
  const bought = trade.side === "buy";
  const rows: Array<[string, string]> = [
    ["Trade", trade.number],
    ["Price", `${formatFace(trade.price, trade.currency)} / ${trade.asset}`],
    [bought ? "You paid" : "You received", formatFace(trade.fiat, trade.currency)],
    [bought ? "Coins bought" : "Coins sold", formatCrypto(trade.amount, trade.asset)],
    ["BitoCard fee", formatCrypto(trade.fee, trade.asset)],
    [bought ? "Coins you received" : "The buyer received", formatCrypto(trade.received, trade.asset)],
    [bought ? "Seller" : "Buyer", trade.counterparty.nickname],
    ["When", tradeDate(trade.completed_at ?? trade.created_at)],
  ];
  return (
    <section className={cardClass} aria-label="Trade receipt">
      <div className="flex items-center gap-3">
        <CoinBadge asset={trade.asset} size="size-12" />
        <div>
          <h1 className="font-display text-xl font-extrabold text-navy-900">
            {bought ? "Bought" : "Sold"} {formatCrypto(bought ? trade.received : trade.amount, trade.asset)}
          </h1>
          <p className="text-sm text-slate-500">{trade.status === "completed" ? "Completed instantly" : trade.status}</p>
        </div>
      </div>
      <dl className="mt-4 divide-y divide-slate-100 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2.5">
            <dt className="text-slate-500">{label}</dt>
            <dd className="text-right font-semibold break-all">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A trade as a list row: what moved, with whom, and when (`href` its receipt). */
export function TradeRow({ trade, href }: { trade: StoreP2pTrade; href: string }) {
  const bought = trade.side === "buy";
  return (
    <Link href={href} className="flex items-center gap-3 py-3 hover:bg-slate-50">
      <CoinBadge asset={trade.asset} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">
          {bought ? "Bought" : "Sold"} {formatCrypto(bought ? trade.received : trade.amount, trade.asset)}
        </span>
        <span className="block truncate text-sm text-slate-500">
          {trade.number} · {bought ? "from" : "to"} {trade.counterparty.nickname} · {tradeDate(trade.created_at)}
        </span>
      </span>
      <span className={`shrink-0 font-semibold ${bought ? "text-navy-900" : "text-emerald-700"}`}>
        {bought ? "−" : "+"}
        {formatFace(trade.fiat, trade.currency)}
      </span>
    </Link>
  );
}

const adStatus: Record<StoreP2pAd["status"], [string, string]> = {
  active: ["On the market", "bg-emerald-50 text-emerald-800"],
  paused: ["Paused", "bg-amber-50 text-amber-800"],
  completed: ["Completed", "bg-slate-100 text-slate-700"],
  cancelled: ["Closed", "bg-slate-100 text-slate-700"],
};

/** One of the customer's own ads: what it sells or buys, how much is filled, its status; `controls` while it is open. */
export function MyAdCard({ ad, controls }: { ad: StoreP2pAd; controls?: ReactNode }) {
  const [label, tone] = adStatus[ad.status];
  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <CoinBadge asset={ad.asset} />
          <div className="min-w-0">
            <p className="font-semibold">
              {ad.side === "sell" ? "Selling" : "Buying"} {formatCrypto(ad.total, ad.asset)}
            </p>
            <p className="text-sm text-slate-500">
              {formatFace(ad.price, ad.currency)} per {ad.asset} · {formatFace(ad.min_fiat, ad.currency)} – {formatFace(ad.max_fiat, ad.currency)}
            </p>
          </div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone}`}>{label}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, (Number(ad.filled) / Number(ad.total)) * 100)}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {formatCrypto(ad.filled, ad.asset)} filled · {formatCrypto(ad.available, ad.asset)} left
      </p>
      {controls && (ad.status === "active" || ad.status === "paused") ? <div className="mt-4 flex flex-wrap items-end gap-2">{controls}</div> : null}
    </li>
  );
}
