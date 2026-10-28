import type { Metadata } from "next";
import type { StoreCryptoWallets, StoreList, StoreP2pAd } from "@bitocard/api-client/storefront";
import { AdControls, PostAdLauncher } from "@afrippa/ui/forms";
import { cardClass, MyAdCard } from "@afrippa/ui/trade-views";
import { AccountShell } from "@/components/account-shell";
import { requireCustomer, tradableAssets } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "My ads", robots: { index: false, follow: false } };

/** The customer's own ads in every market (the shared cards): see fills, change the price, pause or close. */
export default async function AdsPage({ searchParams }: { searchParams: Promise<{ posted?: string }> }) {
  const { posted } = await searchParams;
  await requireCustomer("/ads");
  const [overview, open, closed] = await Promise.all([
    customerApi<StoreCryptoWallets>("GET", "/v1/afrippa/crypto"),
    customerApi<StoreList<StoreP2pAd>>("GET", "/v1/afrippa/p2p/ads"),
    customerApi<StoreList<StoreP2pAd>>("GET", "/v1/afrippa/p2p/ads?status=closed"),
  ]);
  const assets = tradableAssets(overview.ok ? overview.data : null);
  const ads = [...(open.ok ? open.data.data : []), ...(closed.ok ? closed.data.data.slice(0, 10) : [])];
  return (
    <AccountShell title="My ads" current="/ads" action={assets.length ? <PostAdLauncher assets={assets} /> : null}>
      {posted ? (
        <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800" role="status">
          Your ad is on the market. Trades against it settle at once and show in Trades.
        </p>
      ) : null}
      {ads.length ? (
        <ul className="space-y-3" aria-label="Your ads">
          {ads.map(ad => (
            <MyAdCard key={ad.id} ad={ad} controls={<AdControls id={ad.id} status={ad.status} currency={ad.currency} price={ad.price} />} />
          ))}
        </ul>
      ) : (
        <p className={cardClass}>You have no ads yet. Sell ads lock your coins until traded or closed; buy ads lock the money they need.</p>
      )}
    </AccountShell>
  );
}
