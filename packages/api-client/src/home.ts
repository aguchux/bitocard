import type { ShopListingCard } from './classifieds';
import type { SectionSpan, TrustBarSection } from './storefront';

/**
 * udozo.com's home pages (Udozo's API, `src/classifieds/home/`): the page across countries (`global`) and each
 * country's, each with one of three layouts and Udozo's own sections. The admin edits them; udozo.com shows them filled
 * (`GET /v1/classifieds/home?page=`).
 */

type Base<T extends string> = { id: string; type: T; span: SectionSpan; hidden: boolean };

/** Where a slide, banner or tile goes. Across countries there is no search, so only categories and pages. */
export type HomeLink = { kind: 'category'; slug: string } | { kind: 'search'; q: string } | { kind: 'href'; href: string };
export type HomeTileSize = 'sm' | 'wide' | 'tall' | 'lg';
export type HomeTone = 'navy' | 'brand' | 'light';
export type HomeGroupKind = 'category' | 'area' | 'condition' | 'newest' | 'trending';

export type HomeHeroSection = Base<'home_hero'> & {
  style: 'search' | 'carousel' | 'minimal';
  title: string;
  accent: string;
  subtitle: string;
  slides: Array<{ image: string; title: string; subtitle: string; link: HomeLink }>;
};
export type CategoryMasonrySection = Base<'category_masonry'> & { title: string; tiles: Array<{ slug: string; size: HomeTileSize; image: string | null }>; limit: number };
export type DealsRailSection = Base<'deals_rail'> & { title: string; days: number; limit: number; category: string | null };
export type SponsoredRailSection = Base<'sponsored_rail'> & { title: string; limit: number };
export type TopSellingRailSection = Base<'top_selling_rail'> & { title: string; fallbackTitle: string; minimum: number; limit: number };
export type ListingGroupSection = Base<'listing_group'> & { title: string; by: HomeGroupKind; value: string | null; display: 'rail' | 'grid'; limit: number; viewAll: boolean };
export type BannerSection = Base<'banner'> & { items: Array<{ image: string | null; title: string; body: string; link: HomeLink; tone: HomeTone }> };
export type CountryTilesSection = Base<'country_tiles'> & { title: string; countries: string[] };
export type HomeTrustBarSection = TrustBarSection;

export type HomeSection = HomeHeroSection | CategoryMasonrySection | DealsRailSection | SponsoredRailSection | TopSellingRailSection | ListingGroupSection | BannerSection | CountryTilesSection | HomeTrustBarSection;
export type HomeSectionType = HomeSection['type'];

export type HomeLayoutKey = 'marketplace' | 'deals' | 'explorer';
/** How a layout looks: the hero's colour, the cards, the corners and the space between sections. */
export type HomeLook = { hero: HomeTone; cards: 'standard' | 'compact' | 'large'; corners: 'soft' | 'round'; density: 'compact' | 'comfortable' | 'airy' };

// -- What udozo.com reads: each section filled ----------------------------------------------------------------------

/** A listing card on a home page: across countries without its price; Sponsored ones say so; deals carry their "was". */
export type HomeCard = Omit<ShopListingCard, 'price'> & { price?: ShopListingCard['price']; sponsored?: true; was_price?: number | null };
export type HomeTile = { slug: string; name: string; icon: string; listings: number; size: HomeTileSize; image: string | null; href: string };

export type ResolvedHomeSection =
  | (HomeHeroSection & { data: { slides: Array<HomeHeroSection['slides'][number] & { href: string }> } })
  | (CategoryMasonrySection & { data: { tiles: HomeTile[] } })
  | (DealsRailSection & { data: { items: HomeCard[]; view_all_href: string | null } })
  | (SponsoredRailSection & { data: { items: HomeCard[] } })
  | (TopSellingRailSection & { data: { basis: 'sales' | 'popular'; heading: string; items: HomeCard[] } })
  | (ListingGroupSection & { data: { items: HomeCard[]; view_all_href: string | null } })
  | (BannerSection & { data: { items: Array<BannerSection['items'][number] & { href: string }> } })
  | (CountryTilesSection & { data: { countries: Array<{ country: string; name: string; listings: number; href: string }> } })
  | (HomeTrustBarSection & { data: Record<string, never> });

export type ClassifiedHome = {
  object: 'classified_home';
  /** `global`, or the country's code. */
  page: string;
  name: string;
  scope: 'global' | 'country';
  layout: HomeLayoutKey;
  look: HomeLook;
  /** What is shown: the published page, the layout's starting page (nothing published), or the draft (a preview link). */
  source: 'published' | 'default' | 'draft';
  version: number;
  sections: ResolvedHomeSection[];
};

/** A home page's link for a card, slide or banner, as the admin shows it. */
export const homeLinkText = (link: HomeLink) => (link.kind === 'category' ? `Category: ${link.slug}` : link.kind === 'search' ? `Search: ${link.q}` : link.href);
