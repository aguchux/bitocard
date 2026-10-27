import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { StoreCryptoWallets, StoreList, StoreP2pAd } from "@bitocard/api-client/storefront";
import { card, CryptoGate, CryptoNav, tradableAssets } from "@/components/app/crypto";
import { PostAdLauncher } from "@/components/app/p2p-dialogs";
import { MarketAds, MarketFilters } from "@/components/app/p2p-market";
import { customerApi } from "@/lib/customer";
import { marketHref, marketQuery, marketState, shownAds } from "@/lib/p2p-market";

export const metadata: Metadata = { title: "P2P market" };

type Search = Record<string, string | string[] | undefined>;

/**
 * The Crypto tab opens on the P2P market, BitoCard's biggest crypto market, on bitocard.com and resellers' stores
 * alike: the full width of the page (`data-full-bleed` lifts the account app's width limit), the ads as a grid or a
 * list, filters for buying or selling, the coin, the currency, the amount, the trader, experienced traders and the
 * order, and Post ad at the top right. Where P2P is not open to the customer (crypto or P2P switched off for their
 * store or country) the tab opens on their wallets instead, so what they hold is never out of reach.
 */
export default async function MarketPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const overview = await customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto");
  const wallets = overview.ok ? overview.data : null;
  if (wallets && (!wallets.enabled || !wallets.p2p_enabled)) redirect("/account/crypto/wallets");
  const assets = tradableAssets(wallets);
  const state = marketState(params, assets, wallets?.currency ?? "USD");
  const blocked = !wallets || wallets.frozen || !wallets.verified;
  const book = blocked || !assets.length ? null : await customerApi<StoreList<StoreP2pAd>>("GET", `/v1/store/p2p/market?${marketQuery(state)}`);
  const ads = book?.ok ? shownAds(book.data.data, state) : [];
  const filtered = Boolean(state.q || state.amount || state.experienced);

  return (
    <div data-full-bleed className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-extrabold text-navy-900 sm:text-3xl">P2P market{wallets?.mode === "test" ? " (test)" : ""}</h1>
          <p className="text-sm text-slate-600">Buy and sell crypto with other people, paid instantly from your BitoCard wallet.</p>
        </div>
        {!blocked && assets.length ? (
          <span className="flex shrink-0 items-center gap-2">
            <Link href="/account/crypto/ads" className="hidden min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-slate-300 hover:ring-slate-400 sm:inline-flex">
              My ads
            </Link>
            <PostAdLauncher assets={assets} initialAsset={state.asset} initialSide={state.side} />
          </span>
        ) : null}
      </div>
      <CryptoNav current="/account/crypto" />
      {blocked ? <CryptoGate wallets={wallets} p2p /> : null}
      {!blocked && assets.length ? (
        <>
          <MarketFilters state={state} assets={assets} currencies={[...new Set([wallets!.currency, "USD"])]} />
          <p className="text-sm text-slate-600" role="status">
            {book && !book.ok
              ? "The market cannot be shown right now. Try again shortly."
              : `${ads.length} ${ads.length === 1 ? "ad" : "ads"} ${state.side === "buy" ? `selling ${state.asset}` : `buying ${state.asset}`} for ${state.currency}`}
          </p>
          {ads.length ? (
            <MarketAds ads={ads} state={state} />
          ) : book?.ok ? (
            <div className={card}>
              <p className="font-semibold">{filtered ? "No ads match your filters" : state.side === "buy" ? `Nobody is selling ${state.asset} for ${state.currency} right now` : `Nobody is buying ${state.asset} for ${state.currency} right now`}</p>
              <p className="mt-1 text-sm text-slate-600">{filtered ? "Try another amount or trader, or clear the filters." : "Post your own ad and other traders can come to you."}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {filtered ? (
                  <Link href={marketHref(state, { q: "", amount: "", experienced: false })} className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-semibold text-navy-900 ring-1 ring-slate-300">
                    Clear filters
                  </Link>
                ) : null}
                <PostAdLauncher assets={assets} initialAsset={state.asset} initialSide={state.side === "buy" ? "sell" : "buy"} label="Post an ad" />
              </div>
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            Prices are set by traders, not BitoCard. Trades settle at once from your BitoCard wallet; BitoCard&apos;s fee comes out of the crypto received and is shown before you confirm. Your coins, deposits and withdrawals are in{" "}
            <Link href="/account/crypto/wallets" className="font-semibold underline">
              Wallets
            </Link>
            .
          </p>
        </>
      ) : null}
    </div>
  );
}
