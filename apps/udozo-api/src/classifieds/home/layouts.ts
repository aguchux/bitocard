import { randomUUID } from 'node:crypto';
import { type HomeScope, type HomeSection, parseHomeSections } from './layout.js';

/** How a layout looks on udozo.com: the hero's colour, the cards, the corners and the space between sections. */
export type HomeLook = {
  hero: 'navy' | 'brand' | 'light';
  cards: 'standard' | 'compact' | 'large';
  corners: 'soft' | 'round';
  density: 'compact' | 'comfortable' | 'airy';
};

export const homeLayoutKeys = ['marketplace', 'deals', 'explorer'] as const;
export type HomeLayoutKey = (typeof homeLayoutKeys)[number];

export type HomeLayout = {
  key: HomeLayoutKey;
  name: string;
  description: string;
  look: HomeLook;
  /** The sections a page starts with in this layout (the admins then change them in the editor). */
  starter: (scope: HomeScope) => HomeSection[];
};

const full = { lg: 12, md: 6 } as const;
const half = { lg: 6, md: 3 } as const;
const id = () => randomUUID().slice(0, 8);

const trust = (scope: HomeScope) => ({
  id: id(),
  type: 'trust_bar',
  span: full,
  items: [
    { icon: 'shield', title: 'Safe pay', body: 'Udozo holds the money until you have the item.' },
    { icon: 'phone', title: 'Chat and call in the app', body: 'Talk to sellers without sharing your number.' },
    { icon: 'star', title: 'Checked sellers', body: 'Phone confirmed, and ID checked where it shows.' },
    { icon: 'globe', title: scope === 'global' ? 'Across Africa' : 'Near you', body: scope === 'global' ? 'Buy and sell in every country Udozo is open in.' : 'Listings from your area first.' },
  ],
});

const sellBanner = (tone: 'navy' | 'brand' | 'light') => ({ title: 'Sell what you no longer use', body: 'Post an ad in minutes. Listing is free.', link: { kind: 'href', href: '/sell' }, tone });
const safePayBanner = (tone: 'navy' | 'brand' | 'light') => ({ title: 'Pay safely with Safe pay', body: 'Your money is held until you have the item.', link: { kind: 'href', href: '/safe-trade#safe-pay' }, tone });

/**
 * The three home page layouts admins choose from (one per page: the global page and each country's), each a look and
 * a starting set of sections. Explore the world is built around the countries, for the page across them.
 */
export const homeLayouts: HomeLayout[] = [
  {
    key: 'marketplace',
    name: 'Classic marketplace',
    description: 'Search first, then categories as photo tiles, sponsored listings, deals, what sells, and groups by category.',
    look: { hero: 'navy', cards: 'standard', corners: 'soft', density: 'comfortable' },
    starter: scope =>
      parseHomeSections(
        [
          { id: id(), type: 'home_hero', span: full, style: 'search', title: scope === 'global' ? 'Udozo across Africa' : 'Buy and sell near you', accent: 'protected by Safe pay' },
          { id: id(), type: 'category_masonry', span: full },
          { id: id(), type: 'sponsored_rail', span: full },
          scope === 'global' ? { id: id(), type: 'listing_group', span: full, title: 'Trending across countries', by: 'trending' } : { id: id(), type: 'deals_rail', span: full },
          { id: id(), type: 'top_selling_rail', span: full },
          { id: id(), type: 'banner', span: full, items: [sellBanner('brand'), safePayBanner('navy')] },
          { id: id(), type: 'listing_group', span: full, title: 'Just listed', by: 'newest', display: 'grid' },
          trust(scope),
        ],
        scope,
      ),
  },
  {
    key: 'deals',
    name: 'Deals first',
    description: 'A carousel of offers, then price drops, sponsored listings and what sells, with compact cards.',
    look: { hero: 'brand', cards: 'compact', corners: 'soft', density: 'compact' },
    starter: scope =>
      parseHomeSections(
        [
          { id: id(), type: 'home_hero', span: full, style: 'carousel', title: scope === 'global' ? 'Deals across Africa' : 'Deals near you', subtitle: 'Prices that just came down, from sellers near you.' },
          scope === 'global' ? { id: id(), type: 'listing_group', span: full, title: 'Trending now', by: 'trending' } : { id: id(), type: 'deals_rail', span: full, title: 'Price drops' },
          { id: id(), type: 'sponsored_rail', span: full },
          { id: id(), type: 'banner', span: full, items: [safePayBanner('brand')] },
          { id: id(), type: 'top_selling_rail', span: full },
          { id: id(), type: 'category_masonry', span: full, title: 'Browse categories', limit: 6 },
          { id: id(), type: 'listing_group', span: full, title: 'Newest', by: 'newest', display: 'grid', limit: 12 },
        ],
        scope,
      ),
  },
  {
    key: 'explorer',
    name: 'Explore the world',
    description: 'Built around the countries: each open market as a tile, then categories, sponsored and popular listings across them.',
    look: { hero: 'light', cards: 'large', corners: 'round', density: 'airy' },
    starter: scope =>
      parseHomeSections(
        [
          { id: id(), type: 'home_hero', span: full, style: 'minimal', title: scope === 'global' ? 'Explore Udozo' : 'Explore what is for sale', subtitle: scope === 'global' ? 'Choose a country to see prices, or browse across them.' : 'Browse by category and by area.' },
          scope === 'global' ? { id: id(), type: 'country_tiles', span: full } : { id: id(), type: 'listing_group', span: full, title: 'Near you', by: 'trending' },
          { id: id(), type: 'category_masonry', span: full },
          { id: id(), type: 'sponsored_rail', span: half },
          { id: id(), type: 'top_selling_rail', span: half },
          { id: id(), type: 'listing_group', span: full, title: 'Trending', by: 'trending' },
          { id: id(), type: 'listing_group', span: full, title: 'Just listed', by: 'newest', display: 'grid' },
          trust(scope),
        ],
        scope,
      ),
  },
];

export const homeLayoutFor = (key: string): HomeLayout | undefined => homeLayouts.find(layout => layout.key === key);
/** A page's layout until an admin chooses: Explore the world across countries, Classic marketplace in a country. */
export const defaultLayoutFor = (scope: HomeScope): HomeLayout => homeLayoutFor(scope === 'global' ? 'explorer' : 'marketplace')!;
