/**
 * Home's call-to-action banners, as cards in one sliding row: the page's own, then (on the first banner block, where
 * the market sells by auction) Udozo's auctions. Kept free of React Native so it runs under `node --test`.
 */

export type BannerCard = { title: string; body: string; image: string | null; href: string };

/** What a banner's card shows when it has no picture: an icon for where it goes. */
export type BannerIcon = 'sell' | 'pay' | 'auctions' | 'other';

/** Udozo's own card for auctions: listings sold by auction (udozo.com's `/<cc>/auctions`, the search with `sale=auction`). */
export function auctionsCard(country: string): BannerCard {
  return { title: 'Bid on auctions', body: 'Win items at the price you choose.', image: null, href: `/${country.toLowerCase()}/auctions` };
}

/** The cards of a banner block: its own, plus auctions where `auctions` is the market (the page's first banner block). */
export function bannerCards(items: BannerCard[], auctions: string | null): BannerCard[] {
  if (!auctions) return items;
  const card = auctionsCard(auctions);
  return items.some(item => item.href === card.href) ? items : [...items, card];
}

/** The icon for a banner without a picture, from where it goes. */
export function bannerIcon(href: string): BannerIcon {
  const path = href.replace(/^https?:\/\/(www\.)?udozo\.com/, '').split('?')[0];
  if (/^\/[a-z]{2}\/auctions\/?$/.test(path)) return 'auctions';
  if (/^\/(sell|[a-z]{2}\/sell)\/?$/.test(path) || path.startsWith('/account/listings')) return 'sell';
  if (/udozopay|safe-pay|safe-trade/.test(path)) return 'pay';
  return 'other';
}
