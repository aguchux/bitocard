import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, Radio } from "lucide-react";
import { ratePercent, type StoreAirtimeNetwork, type StoreAirtimePool } from "@bitocard/api-client/storefront";
import { RefreshWhile } from "@/components/store/order-status";
import { money } from "@/lib/money";
import { NetworkMark } from "./network-mark";

/**
 * The airtime pool, shown to everyone: what BitoCard holds to sell on each network right now, what it bought from
 * customers and sold in the last 24 hours and in all, and its two rates. Refreshes itself every 20 seconds while shown.
 * `signedIn` false sends the buttons through sign-in first.
 */
export function AirtimePoolBoard({ pool, signedIn }: { pool: StoreAirtimePool; signedIn: boolean }) {
  const currency = pool.currency ?? "NGN";
  const through = (path: string) => (signedIn ? path : `/signin?next=${encodeURIComponent(path)}`);
  return (
    <section aria-labelledby="airtime-pool" className="space-y-4">
      <RefreshWhile active everyMs={20_000} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="airtime-pool" className="text-xl font-extrabold tracking-tight">
            Airtime pool
          </h2>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Radio className="size-4 text-green-600" aria-hidden="true" /> Live: updates as people sell and buy{pool.mode === "test" ? " (sandbox)" : ""}
          </p>
        </div>
        {!pool.open ? <span className="rounded-full bg-amber-50 px-3 py-1.5 text-sm font-semibold text-amber-900">Opening soon</span> : null}
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Available now", pool.totals.available],
          ["Bought, last 24 hours", pool.totals.bought_24h],
          ["Sold, last 24 hours", pool.totals.sold_24h],
          ["Bought in all", pool.totals.bought_total],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
            <dt className="text-sm text-slate-500">{label}</dt>
            <dd className="font-display text-xl font-extrabold tabular-nums">{money(value as number, currency)}</dd>
          </div>
        ))}
      </dl>

      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {pool.networks.map(network => (
          <NetworkCard key={network.network} network={network} currency={currency} through={through} />
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        Rates are a share of the airtime’s face value. Sellers are paid into their BitoCard wallet after a short hold; airtime bought is sent within the hour or refunded.
      </p>
    </section>
  );
}

function NetworkCard({ network, currency, through }: { network: StoreAirtimeNetwork; currency: string; through: (path: string) => string }) {
  const canBuy = network.open && network.available >= network.min_amount;
  return (
    <li className="flex flex-col rounded-3xl bg-white p-4 ring-1 ring-slate-200/70">
      <div className="flex items-center gap-3">
        <NetworkMark network={network.network} name={network.name} />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{network.name}</p>
          <p className="text-xs text-slate-500">{network.open ? "Trading" : "Not open yet"}</p>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-500">Available to buy</p>
      <p className="font-display text-2xl font-extrabold tabular-nums">{money(network.available, currency)}</p>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">We pay sellers</dt>
        <dd className="text-right font-semibold">{ratePercent(network.sell_rate_bps)}</dd>
        <dt className="text-slate-500">Buyers pay</dt>
        <dd className="text-right font-semibold">{ratePercent(network.buy_rate_bps)}</dd>
        <dt className="text-slate-500">Bought, 24h</dt>
        <dd className="text-right tabular-nums">{money(network.bought_24h, currency)}</dd>
        <dt className="text-slate-500">Sold, 24h</dt>
        <dd className="text-right tabular-nums">{money(network.sold_24h, currency)}</dd>
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {network.open ? (
          <Link href={through(`/account/airtime/sell?network=${network.network}`)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold ring-1 ring-slate-200 hover:ring-slate-300">
            <ArrowUpFromLine className="size-4" aria-hidden="true" /> Sell
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-50 px-3 text-sm font-semibold text-slate-400">Sell</span>
        )}
        {canBuy ? (
          <Link href={through(`/account/airtime/buy?network=${network.network}`)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-brand-500 px-3 text-sm font-semibold text-white hover:bg-brand-600">
            <ArrowDownToLine className="size-4" aria-hidden="true" /> Buy
          </Link>
        ) : (
          <span className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-50 px-3 text-sm font-semibold text-slate-400" title={network.open ? "None available right now" : undefined}>
            Buy
          </span>
        )}
      </div>
    </li>
  );
}
