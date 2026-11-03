import { randomUUID } from 'node:crypto';
import { type HomeRow, type HomeScope, parseHomeRows } from './layout.js';

/** How a layout looks on udozo.com: the hero's colour, the cards, the corners and the space between rows. */
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
  /** The rows a page starts with in this layout (the admins then change them in the editor). */
  starter: (scope: HomeScope) => HomeRow[];
};

const full = { lg: 12, md: 6 } as const;
const half = { lg: 6, md: 3 } as const;
const id = () => randomUUID().slice(0, 8);

type Block = Record<string, unknown> & { type: string };

/** A row of blocks, with its heading and settings (the rest default). */
const row = (blocks: Block[], settings: Record<string, unknown> = {}) => ({ id: id(), ...settings, blocks: blocks.map(block => ({ id: id(), span: full, ...block })) });

const trust = (scope: HomeScope): Block => ({
  type: 'trust_bar',
  items: [
    { icon: 'shield', title: 'Safe pay', body: 'Udozo holds the money until you have the item.' },
    { icon: 'phone', title: 'Chat and call in the app', body: 'Talk to sellers without sharing your number.' },
    { icon: 'star', title: 'Checked sellers', body: 'Phone confirmed, and ID checked where it shows.' },
    { icon: 'globe', title: scope === 'global' ? 'Across Africa' : 'Near you', body: scope === 'global' ? 'Buy and sell in every country Udozo is open in.' : 'Listings from your area first.' },
  ],
});

const sellBanner = (tone: 'navy' | 'brand' | 'light') => ({ title: 'Sell what you no longer use', body: 'Post an ad in minutes. Listing is free.', link: { kind: 'href', href: '/sell' }, tone });
const safePayBanner = (tone: 'navy' | 'brand' | 'light') => ({ title: 'Pay safely with Safe pay', body: 'Your money is held until you have the item.', link: { kind: 'href', href: '/safe-trade#safe-pay' }, tone });
/** Two category banners side by side: phones and vehicles, what sells most in every market. */
const categoryBanners = (tone: 'navy' | 'brand' | 'light'): Block[] => [
  { type: 'category_banner', span: half, category: 'phones-tablets', tone, body: 'Phones and tablets from sellers near you.' },
  { type: 'category_banner', span: half, category: 'vehicles', tone: tone === 'navy' ? 'brand' : 'navy', body: 'Cars, motorbikes and kekes.' },
];
const storesRow = (scope: HomeScope) => (scope === 'country' ? [row([{ type: 'store_marquee', title: '' }], { title: 'Shops on Udozo', subtitle: 'Stores selling across the marketplace.' })] : []);

/**
 * The three home page layouts admins choose from (one per page: the global page and each country's), each a look and
 * a starting set of rows. Explore the world is built around the countries, for the page across them.
 */
export const homeLayouts: HomeLayout[] = [
  {
    key: 'marketplace',
    name: 'Classic marketplace',
    description: 'Search first, then categories as photo tiles, sponsored listings, deals, a moving rail of what is trending, and groups by category.',
    look: { hero: 'navy', cards: 'standard', corners: 'soft', density: 'comfortable' },
    starter: scope =>
      parseHomeRows(
        [
          row([{ type: 'home_hero', style: 'search', title: scope === 'global' ? 'Udozo across Africa' : 'Buy and sell near you', accent: 'protected by Safe pay' }], { width: 'full' }),
          row([{ type: 'category_masonry' }]),
          row([{ type: 'sponsored_rail' }]),
          row([scope === 'global' ? { type: 'listing_group', title: 'Trending across countries', by: 'trending' } : { type: 'deals_rail' }]),
          row([{ type: 'listing_marquee', title: '', fill: { by: 'trending', value: null } }], { title: 'Trending now', background: 'soft' }),
          row(categoryBanners('navy')),
          row([{ type: 'top_selling_rail' }]),
          ...storesRow(scope),
          row([{ type: 'banner', items: [sellBanner('brand'), safePayBanner('navy')] }]),
          row([{ type: 'listing_group', title: 'Just listed', by: 'newest', display: 'grid' }]),
          row([trust(scope)]),
        ],
        scope,
      ),
  },
  {
    key: 'deals',
    name: 'Deals first',
    description: 'A carousel of offers, then price drops, a moving rail of deals, sponsored listings and what sells, with compact cards.',
    look: { hero: 'brand', cards: 'compact', corners: 'soft', density: 'compact' },
    starter: scope =>
      parseHomeRows(
        [
          row([{ type: 'home_hero', style: 'carousel', title: scope === 'global' ? 'Deals across Africa' : 'Deals near you', subtitle: 'Prices that just came down, from sellers near you.' }], { width: 'full' }),
          row([scope === 'global' ? { type: 'listing_group', title: 'Trending now', by: 'trending' } : { type: 'deals_rail', title: 'Price drops' }]),
          row([{ type: 'listing_marquee', title: '', cards: 'compact', speed: 'fast', fill: { by: scope === 'global' ? 'newest' : 'deals', value: null } }], { title: scope === 'global' ? 'Just in' : 'More deals', background: 'brand' }),
          row([{ type: 'sponsored_rail' }]),
          row([{ type: 'banner', items: [safePayBanner('brand')] }]),
          row([{ type: 'top_selling_rail' }]),
          row(categoryBanners('brand')),
          row([{ type: 'category_masonry', title: 'Browse categories', limit: 6 }]),
          row([{ type: 'listing_group', title: 'Newest', by: 'newest', display: 'grid', limit: 12 }]),
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
      parseHomeRows(
        [
          row([{ type: 'home_hero', style: 'minimal', title: scope === 'global' ? 'Explore Udozo' : 'Explore what is for sale', subtitle: scope === 'global' ? 'Choose a country to see prices, or browse across them.' : 'Browse by category and by area.' }], { width: 'full' }),
          row([scope === 'global' ? { type: 'country_tiles' } : { type: 'listing_group', title: 'Near you', by: 'trending' }]),
          row([{ type: 'category_masonry' }]),
          row([
            { type: 'sponsored_rail', span: half },
            { type: 'top_selling_rail', span: half },
          ]),
          row([{ type: 'listing_marquee', title: '', speed: 'slow', fill: { by: 'trending', value: null } }], { title: 'Trending', background: 'soft' }),
          ...storesRow(scope),
          row([{ type: 'listing_group', title: 'Just listed', by: 'newest', display: 'grid' }]),
          row([trust(scope)]),
        ],
        scope,
      ),
  },
];

export const homeLayoutFor = (key: string): HomeLayout | undefined => homeLayouts.find(layout => layout.key === key);
/** A page's layout until an admin chooses: Explore the world across countries, Classic marketplace in a country. */
export const defaultLayoutFor = (scope: HomeScope): HomeLayout => homeLayoutFor(scope === 'global' ? 'explorer' : 'marketplace')!;
