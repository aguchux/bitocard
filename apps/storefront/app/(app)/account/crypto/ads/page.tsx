import type { Metadata } from "next";
import type { StoreCryptoWallets, StoreList, StoreP2pAd } from "@bitocard/api-client/storefront";
import { AdControls } from "@bitocard/crypto-ui/forms";
import { MyAdCard } from "@bitocard/crypto-ui/trade-views";
import { card, CryptoGate, CryptoNav, tradableAssets } from "@/components/app/crypto";
import { PostAdLauncher } from "@/components/app/p2p-dialogs";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "My ads" };

/** The customer's own ads: see fills, change price, pause or close. */
export default async function AdsPage({ searchParams }: { searchParams: Promise<{ posted?: string }> }) {
  const params = await searchParams;
  const [overview, open, closed] = await Promise.all([
    customerApi<StoreCryptoWallets>("GET", "/v1/store/crypto"),
    customerApi<StoreList<StoreP2pAd>>("GET", "/v1/store/p2p/ads"),
    customerApi<StoreList<StoreP2pAd>>("GET", "/v1/store/p2p/ads?status=closed"),
  ]);
  const wallets = overview.ok ? overview.data : null;
  const blocked = !wallets || !wallets.p2p_enabled || wallets.frozen || !wallets.verified;
  const ads = [...(open.ok ? open.data.data : []), ...(closed.ok ? closed.data.data.slice(0, 10) : [])];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-extrabold text-navy-900">My ads</h1>
        {!blocked && wallets && tradableAssets(wallets).length ? <PostAdLauncher assets={tradableAssets(wallets)} /> : null}
      </div>
      <CryptoNav current="/account/crypto/ads" />
      {params.posted ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
          Your ad is on the market. Trades against it settle at once and show in Trades.
        </p>
      ) : null}
      {blocked ? <CryptoGate wallets={wallets} p2p /> : null}
      {ads.length ? (
        <ul className="space-y-3" aria-label="Your ads">
          {ads.map(ad => (
            <MyAdCard key={ad.id} ad={ad} controls={<AdControls id={ad.id} status={ad.status} currency={ad.currency} price={ad.price} />} />
          ))}
        </ul>
      ) : !blocked ? (
        <p className={card}>You have no ads yet. Sell ads lock your coins until traded or closed; buy ads lock the money they need.</p>
      ) : null}
    </div>
  );
}
