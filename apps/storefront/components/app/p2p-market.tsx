import Link from "next/link";
import { BadgeCheck, LayoutGrid, List, Search, SlidersHorizontal } from "lucide-react";
import { formatCrypto, formatFace, type StoreP2pAd } from "@bitocard/api-client/storefront";
import { experiencedTrades, marketHref, marketPath, type MarketState } from "@/lib/p2p-market";
import { CoinBadge } from "./crypto";
import { TakeAdDialog } from "./p2p-dialogs";

const major = (minor: number) => (minor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
const chip = "inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors focus-visible:outline-3 focus-visible:outline-offset-5 focus-visible:outline-brand-700";
const chipOn = "bg-navy-900 text-white ring-navy-900";
const chipOff = "bg-white text-slate-700 ring-slate-200 hover:ring-slate-300";

/** The trader: their market name, a tick once experienced, and their completed trades. */
function Trader({ ad }: { ad: StoreP2pAd }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-bold text-navy-900 uppercase">
        {ad.trader.nickname.slice(0, 1)}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1 font-semibold">
          <span className="truncate">{ad.trader.nickname}</span>
          {ad.trader.trades_total >= experiencedTrades ? <BadgeCheck className="size-4 shrink-0 text-brand-500" aria-label="Experienced trader" /> : null}
        </span>
        <span className="block text-xs text-slate-500">
          {ad.trader.trades_30d} in 30 days · {ad.trader.trades_total} in all
        </span>
      </span>
    </span>
  );
}

function Take({ ad, side }: { ad: StoreP2pAd; side: "buy" | "sell" }) {
  return <TakeAdDialog adId={ad.id} price={ad.price} currency={ad.currency} side={side} min={major(ad.min_fiat)} max={major(ad.max_fiat)} asset={ad.asset} />;
}

/** One ad as a card (the grid view). */
export function AdCard({ ad, side }: { ad: StoreP2pAd; side: "buy" | "sell" }) {
  return (
    <li className="flex min-w-0 flex-col rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 transition hover:shadow-md hover:ring-slate-300">
      <div className="flex items-start justify-between gap-3">
        <Trader ad={ad} />
        <CoinBadge asset={ad.asset} size="size-8" />
      </div>
      <p className="mt-4">
        <span className="block font-display text-2xl font-extrabold text-navy-900">{formatFace(ad.price, ad.currency)}</span>
        <span className="block text-xs text-slate-500">per {ad.asset}</span>
      </p>
      {/* One row each, label and value apart, so the limits never break over two lines on a phone. */}
      <dl className="mt-3 space-y-1.5 border-t border-slate-100 pt-3 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-xs text-slate-500">{side === "buy" ? "Available" : "Wants"}</dt>
          <dd className="min-w-0 truncate text-right font-semibold">{formatCrypto(ad.available, ad.asset)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-xs text-slate-500">Per trade</dt>
          <dd className="min-w-0 text-right font-semibold">
            {formatFace(ad.min_fiat, ad.currency)} – {formatFace(ad.max_fiat, ad.currency)}
          </dd>
        </div>
      </dl>
      {ad.terms ? <p className="mt-3 line-clamp-3 rounded-xl bg-slate-50 px-3 py-2 text-sm break-words text-slate-600">{ad.terms}</p> : null}
      <div className="mt-auto pt-4 [&>button]:w-full">
        <Take ad={ad} side={side} />
      </div>
    </li>
  );
}

/** One ad as a row (the list view): stacked on phones, columns from tablets up. */
export function AdRow({ ad, side }: { ad: StoreP2pAd; side: "buy" | "sell" }) {
  return (
    <li className="grid min-w-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] sm:items-center sm:gap-4 sm:px-5">
      <Trader ad={ad} />
      <p>
        <span className="font-display text-lg font-extrabold text-navy-900">{formatFace(ad.price, ad.currency)}</span>
        <span className="text-xs text-slate-500"> / {ad.asset}</span>
      </p>
      <p className="text-sm">
        <span className="text-xs text-slate-500 sm:hidden">{side === "buy" ? "Available " : "Wants "}</span>
        <span className="font-semibold">{formatCrypto(ad.available, ad.asset)}</span>
      </p>
      <p className="text-sm">
        <span className="text-xs text-slate-500 sm:hidden">Per trade </span>
        <span className="font-semibold">
          {formatFace(ad.min_fiat, ad.currency)} – {formatFace(ad.max_fiat, ad.currency)}
        </span>
      </p>
      <div className="[&>button]:w-full sm:[&>button]:w-auto">
        <Take ad={ad} side={side} />
      </div>
    </li>
  );
}

const segment = "flex gap-1 rounded-xl bg-white p-1 ring-1 ring-slate-200";
const segmentItem = (on: boolean) => `inline-flex min-h-9 items-center justify-center rounded-lg px-3 text-sm font-semibold ${on ? "bg-navy-900 text-white" : "text-slate-600"}`;
const field = "block min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base text-navy-900";

function SideToggle({ state }: { state: MarketState }) {
  return (
    <nav aria-label="Buy or sell" className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200">
      {(["buy", "sell"] as const).map(side => (
        <Link
          key={side}
          href={marketHref(state, { side })}
          aria-current={state.side === side ? "page" : undefined}
          className={`flex min-h-10 min-w-20 items-center justify-center rounded-xl px-4 text-sm font-bold transition-colors ${state.side === side ? (side === "buy" ? "bg-emerald-600 text-white" : "bg-brand-500 text-white") : "text-slate-600 hover:text-navy-900"}`}
        >
          {side === "buy" ? "Buy" : "Sell"}
        </Link>
      ))}
    </nav>
  );
}

/** The coins as chips: one row, scrolling sideways inside itself where they do not fit. */
function CoinChips({ state, assets, className = "" }: { state: MarketState; assets: string[]; className?: string }) {
  return (
    <nav aria-label="Coin" className={`-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] ${className}`}>
      {assets.map(asset => (
        <Link key={asset} href={marketHref(state, { asset })} aria-current={state.asset === asset ? "page" : undefined} className={`${chip} ${state.asset === asset ? chipOn : chipOff}`}>
          <CoinBadge asset={asset} size="size-8" />
          {asset}
        </Link>
      ))}
    </nav>
  );
}

function CurrencyToggle({ state, currencies }: { state: MarketState; currencies: string[] }) {
  if (currencies.length < 2) return null;
  return (
    <nav aria-label="Currency" className={segment}>
      {currencies.map(code => (
        <Link key={code} href={marketHref(state, { currency: code })} aria-current={state.currency === code ? "page" : undefined} className={segmentItem(state.currency === code)}>
          {code}
        </Link>
      ))}
    </nav>
  );
}

function ExperiencedChip({ state }: { state: MarketState }) {
  return (
    <Link href={marketHref(state, { experienced: !state.experienced })} aria-pressed={state.experienced} className={`${chip} ${state.experienced ? chipOn : chipOff}`}>
      <BadgeCheck className="size-4" aria-hidden="true" /> Experienced traders
    </Link>
  );
}

function SortToggle({ state }: { state: MarketState }) {
  return (
    <nav aria-label="Order" className={segment}>
      {(["price", "trades"] as const).map(sort => (
        <Link key={sort} href={marketHref(state, { sort })} aria-current={state.sort === sort ? "page" : undefined} className={segmentItem(state.sort === sort)}>
          {sort === "price" ? "Best price" : "Most trades"}
        </Link>
      ))}
    </nav>
  );
}

function ViewToggle({ state }: { state: MarketState }) {
  return (
    <nav aria-label="View" className={segment}>
      {(["grid", "list"] as const).map(view => {
        const Icon = view === "grid" ? LayoutGrid : List;
        return (
          <Link key={view} href={marketHref(state, { view })} aria-current={state.view === view ? "page" : undefined} aria-label={view === "grid" ? "Grid" : "List"} title={view === "grid" ? "Grid" : "List"} className={`grid size-9 place-items-center rounded-lg ${state.view === view ? "bg-navy-900 text-white" : "text-slate-600"}`}>
            <Icon className="size-4" aria-hidden="true" />
          </Link>
        );
      })}
    </nav>
  );
}

/** The filters the forms do not ask for, kept as they are. */
function Kept({ state }: { state: MarketState }) {
  return (
    <>
      <input type="hidden" name="side" value={state.side} />
      <input type="hidden" name="asset" value={state.asset} />
      <input type="hidden" name="currency" value={state.currency} />
      <input type="hidden" name="sort" value={state.sort} />
      <input type="hidden" name="view" value={state.view} />
      {state.experienced ? <input type="hidden" name="experienced" value="1" /> : null}
    </>
  );
}

const amountLabel = (state: MarketState) => (state.side === "buy" ? `I want to spend (${state.currency})` : `I want to receive (${state.currency})`);

/**
 * The market's filters: buy or sell, the coin, the currency, the amount and the trader (a GET form keeping the other
 * filters as hidden fields), experienced traders only, the order, and grid or list. Everything is a link or a plain
 * GET form, so it works without script and every view can be shared. Phones get a compact bar, so the ads start
 * high on the first screen: the amount with Find, and the trader, experienced and order under More filters (open
 * while any of them is set); wider screens get it all in two rows across the full width.
 */
export function MarketFilters({ state, assets, currencies }: { state: MarketState; assets: string[]; currencies: string[] }) {
  const more = Boolean(state.q || state.experienced || state.sort !== "price");
  return (
    <>
      <div className="space-y-2.5 rounded-3xl bg-slate-50 p-3 ring-1 ring-slate-200/70 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <SideToggle state={state} />
          <CurrencyToggle state={state} currencies={currencies} />
        </div>
        <CoinChips state={state} assets={assets} />
        <form action={marketPath} className="space-y-2.5">
          <Kept state={state} />
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">
              {amountLabel(state)}
              <input type="text" inputMode="decimal" name="amount" defaultValue={state.amount} placeholder="Any amount" className={`mt-1 ${field}`} />
            </label>
            <button type="submit" aria-label="Find ads" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white">
              <Search className="size-4" aria-hidden="true" /> Find
            </button>
          </div>
          <div className="relative">
            <details open={more}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 pr-24 text-sm font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal className="size-4" aria-hidden="true" /> More filters{more ? " (on)" : ""}
              </summary>
              <div className="space-y-2.5 pt-1">
                <label className="block text-xs font-semibold text-slate-600">
                  Trader
                  <input type="search" name="q" defaultValue={state.q} placeholder="Search a market name" className={`mt-1 ${field}`} />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <ExperiencedChip state={state} />
                  <SortToggle state={state} />
                </div>
              </div>
            </details>
            <div className="absolute top-0 right-0">
              <ViewToggle state={state} />
            </div>
          </div>
        </form>
      </div>
      <div className="hidden space-y-3 rounded-3xl bg-slate-50 p-4 ring-1 ring-slate-200/70 lg:block">
        <div className="flex items-center gap-3">
          <SideToggle state={state} />
          <CoinChips state={state} assets={assets} className="flex-1" />
          <CurrencyToggle state={state} currencies={currencies} />
        </div>
        <form action={marketPath} className="flex flex-wrap items-end gap-2">
          <Kept state={state} />
          <label className="w-56 text-xs font-semibold text-slate-600">
            {amountLabel(state)}
            <input type="text" inputMode="decimal" name="amount" defaultValue={state.amount} placeholder="Any amount" className={`mt-1 ${field}`} />
          </label>
          <label className="w-72 text-xs font-semibold text-slate-600">
            Trader
            <input type="search" name="q" defaultValue={state.q} placeholder="Search a market name" className={`mt-1 ${field}`} />
          </label>
          <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
            <Search className="size-4" aria-hidden="true" /> Find ads
          </button>
          <span className="flex flex-1 flex-wrap items-center justify-end gap-2">
            <ExperiencedChip state={state} />
            <SortToggle state={state} />
            <ViewToggle state={state} />
          </span>
        </form>
      </div>
    </>
  );
}

/** The ads, as cards or rows. */
export function MarketAds({ ads, state }: { ads: StoreP2pAd[]; state: MarketState }) {
  if (state.view === "list") {
    return (
      <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-slate-200/70">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] gap-4 border-b border-slate-100 bg-slate-50 px-5 py-2.5 text-xs font-bold tracking-wider text-slate-500 uppercase sm:grid">
          <span>Trader</span>
          <span>Price</span>
          <span>{state.side === "buy" ? "Available" : "Wants"}</span>
          <span>Per trade</span>
          <span className="w-24" />
        </div>
        <ul className="divide-y divide-slate-100">
          {ads.map(ad => (
            <AdRow key={ad.id} ad={ad} side={state.side} />
          ))}
        </ul>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {ads.map(ad => (
        <AdCard key={ad.id} ad={ad} side={state.side} />
      ))}
    </ul>
  );
}
