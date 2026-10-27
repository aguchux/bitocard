import type { StoreP2pAd } from "@bitocard/api-client/storefront";
import { MarketAds as Ads, type AdAction } from "@bitocard/crypto-ui/market-view";
import type { MarketState } from "@/lib/p2p-market";
import { TakeAdDialog } from "./p2p-dialogs";

export { AdCard, AdRow, MarketFilters } from "@bitocard/crypto-ui/market-view";

const major = (minor: number) => (minor / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });

/** Taking an ad in the store: a dialog to trade from the customer's BitoCard wallets. */
export const takeAd: AdAction = (ad, side) => (
  <TakeAdDialog adId={ad.id} price={ad.price} currency={ad.currency} side={side} min={major(ad.min_fiat)} max={major(ad.max_fiat)} asset={ad.asset} />
);

/** The ads, as cards or rows (`@bitocard/crypto-ui`), each taken with the store's dialog. */
export function MarketAds({ ads, state }: { ads: StoreP2pAd[]; state: MarketState }) {
  return <Ads ads={ads} state={state} action={takeAd} />;
}
