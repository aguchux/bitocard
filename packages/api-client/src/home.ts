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

export type HomeMarqueeSpeed = 'slow' | 'normal' | 'fast';
export type HomeMarqueeFill = 'none' | 'newest' | 'trending' | 'category' | 'deals';
/** Listings sliding past on their own: the picks (listing numbers) first, then filled from a source to `limit`. */
export type ListingMarqueeSection = Base<'listing_marquee'> & {
  title: string;
  picks: string[];
  fill: { by: HomeMarqueeFill; value: string | null };
  limit: number;
  speed: HomeMarqueeSpeed;
  direction: 'left' | 'right';
  cards: 'standard' | 'compact';
};
export type StoreMarqueeSection = Base<'store_marquee'> & { title: string; picks: string[]; fill: 'none' | 'most_listings' | 'newest'; limit: number; speed: HomeMarqueeSpeed; direction: 'left' | 'right' };
export type HomeMasonryTile =
  | { kind: 'category'; slug: string; size: HomeTileSize; image: string | null }
  | { kind: 'listing'; ref: string; size: HomeTileSize }
  | { kind: 'image'; image: string; title: string; link: HomeLink; size: HomeTileSize };
export type MasonryGridSection = Base<'masonry_grid'> & { title: string; tiles: HomeMasonryTile[] };
export type CategoryBannerSection = Base<'category_banner'> & {
  category: string;
  title: string;
  body: string;
  image: string | null;
  tone: HomeTone;
  style: 'split' | 'overlay';
  cta: string;
  showCount: boolean;
};

/** A block of a row: every section type of before, the marquees, masonry grids and category banners. */
export type HomeSection =
  | HomeHeroSection
  | CategoryMasonrySection
  | DealsRailSection
  | SponsoredRailSection
  | TopSellingRailSection
  | ListingGroupSection
  | BannerSection
  | CountryTilesSection
  | HomeTrustBarSection
  | ListingMarqueeSection
  | StoreMarqueeSection
  | MasonryGridSection
  | CategoryBannerSection;
export type HomeSectionType = HomeSection['type'];
export type HomeBlock = HomeSection;
export type HomeBlockType = HomeSectionType;

export type HomeRowBackground = 'none' | 'soft' | 'navy' | 'brand' | 'image';
/** A row of a page: its heading and "See all", background, width and spacing, and up to six blocks. */
export type HomeRow = {
  id: string;
  hidden: boolean;
  title: string;
  subtitle: string;
  viewAll: HomeLink | null;
  background: HomeRowBackground;
  image: string | null;
  width: 'contained' | 'full';
  spacing: 'tight' | 'normal' | 'loose';
  blocks: HomeBlock[];
};

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
  | (HomeTrustBarSection & { data: Record<string, never> })
  | (ListingMarqueeSection & { data: { items: HomeCard[] } })
  | (StoreMarqueeSection & { data: { stores: HomeStoreCard[] } })
  | (MasonryGridSection & { data: { tiles: HomeMasonryCell[] } })
  | (CategoryBannerSection & { data: { category: { slug: string; name: string; icon: string; listings: number } | null; title?: string; image?: string | null; href?: string } });

/** A reseller's store live on its own domain, in a stores marquee. */
export type HomeStoreCard = { object: 'home_store'; id: string; name: string; logo_url: string | null; primary_color: string; url: string; country: string | null; listings: number };
/** A masonry grid's tile as shown: a category (its count), a listing (its card) or a photo. */
export type HomeMasonryCell = { kind: 'category' | 'listing' | 'image'; size: HomeTileSize; title: string; image: string | null; href: string; listings?: number; slug?: string; listing?: HomeCard };
/** A row as shown: hidden blocks left out, each filled; `view_all_href` where its "See all" goes. */
export type ResolvedHomeRow = Omit<HomeRow, 'blocks'> & { view_all_href: string | null; blocks: ResolvedHomeSection[] };

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
  /** The page's rows (Udozo's API since rows; absent from one that predates them). */
  rows?: ResolvedHomeRow[];
  /** Every block as one list. */
  sections: ResolvedHomeSection[];
};

/** A home page's link for a card, slide or banner, as the admin shows it. */
export const homeLinkText = (link: HomeLink) => (link.kind === 'category' ? `Category: ${link.slug}` : link.kind === 'search' ? `Search: ${link.q}` : link.href);
