import { randomUUID } from 'node:crypto';
import type { ProductCategory } from '../generated/prisma/client.js';
import { type SectionType, type Sections, sections } from '../storefront/layout.js';

/**
 * Reseller store templates. A template decides what a store sells (its categories, or one product, or BitoCard Shop
 * listings) and which sections its editor offers; each has design variants with their own look (light or dark, the hero,
 * corners, cards, type) and starting home page, and each variant several colour themes. Defined in code, like the
 * layout's sections, so the storefront and SHQ always agree.
 */

export type ThemeColors = {
  /** Buttons, links and highlights. */
  primary: string;
  /** Badges, prices and the second highlight. */
  accent: string;
  /** The page behind everything. */
  background: string;
  /** Cards and panels. */
  surface: string;
  /** Body text. */
  ink: string;
  /** Secondary text. */
  muted: string;
  /** The hero's gradient and its text. */
  heroFrom: string;
  heroTo: string;
  heroInk: string;
};

export type StoreTheme = { key: string; name: string; colors: ThemeColors };

/** How a variant draws the store; the storefront reads these. */
export type VariantStyle = {
  mode: 'light' | 'dark';
  /** The hero's layout. */
  hero: 'search' | 'gradient' | 'minimal' | 'quick_buy' | 'networks' | 'billers' | 'card_wall' | 'boutique' | 'neon' | 'terminal' | 'market' | 'swap' | 'spotlight' | 'split' | 'story' | 'shield' | 'devices' | 'tunnel' | 'desktop' | 'rack' | 'blueprint' | 'showroom' | 'shelf' | 'aisle';
  corners: 'sharp' | 'soft' | 'round';
  cards: 'flat' | 'raised' | 'outline' | 'glass';
  font: 'sans' | 'display' | 'mono' | 'serif';
  /** Section spacing. */
  density: 'compact' | 'comfortable' | 'airy';
};

export type TemplateVariant = { key: string; name: string; description: string; style: VariantStyle; themes: StoreTheme[]; starter: () => unknown[] };

export type TemplateKey = 'all_in_one' | 'topups' | 'gift_cards' | 'single_product' | 'vpn_shop' | 'rdp_shop' | 'resale_shop';

export type StoreTemplate = {
  key: TemplateKey;
  name: string;
  tagline: string;
  description: string;
  /** What the store sells: these categories, every category (null), or nothing from the catalogue (the Resale shop). */
  categories: ProductCategory[] | null;
  /** The store sells one product, chosen as its `focus`. */
  single: boolean;
  /** The store sells BitoCard Shop suppliers' resale listings, never catalogue products (B2B reselling). */
  resale?: boolean;
  /** Sections its editor offers. */
  sections: SectionType[];
  variants: TemplateVariant[];
};

const id = () => randomUUID().slice(0, 8);
const full = { lg: 12, md: 6 } as const;
const half = { lg: 6, md: 6 } as const;
const third = { lg: 4, md: 3 } as const;

const theme = (key: string, name: string, colors: ThemeColors): StoreTheme => ({ key, name, colors });

/** Trust points every store can show, worded for its template. */
const trust = (items: Array<[string, string, string]>) => ({ id: id(), type: 'trust_bar', span: full, items: items.map(([icon, title, body]) => ({ icon, title, body })) });

const everyday = trust([
  ['lock', 'Secure checkout', 'Your information is protected.'],
  ['bolt', 'Digital delivery', 'Most products arrive in minutes.'],
  ['card', 'Local payment options', 'Pay the way that suits you.'],
  ['support', 'Help when you need it', 'We are here if anything goes wrong.'],
]);

// -- 1. All-in-one store --------------------------------------------------------------------------------------------

const allInOne: StoreTemplate = {
  key: 'all_in_one',
  name: 'All-in-one store',
  tagline: 'Everything you sell, in one store.',
  description: 'Gift cards, top-ups, bills, eSIMs, software and more: a full catalogue with search, categories, brands and product rails.',
  categories: null,
  single: false,
  sections: ['hero', 'product_rail', 'category_grid', 'brand_grid', 'promo', 'trust_bar', 'quick_buy', 'features', 'faq'],
  variants: [
    {
      key: 'classic',
      name: 'Classic',
      description: 'A deep hero with search and category chips, then product rails, categories and brands.',
      style: { mode: 'light', hero: 'search', corners: 'round', cards: 'raised', font: 'sans', density: 'comfortable' },
      themes: [
        theme('navy_pink', 'Navy and pink', { primary: '#070f4c', accent: '#ff2382', background: '#f6f7fb', surface: '#ffffff', ink: '#0b1033', muted: '#5b6180', heroFrom: '#070f4c', heroTo: '#1d2a8a', heroInk: '#ffffff' }),
        theme('emerald', 'Emerald', { primary: '#065f46', accent: '#f59e0b', background: '#f4faf7', surface: '#ffffff', ink: '#062a20', muted: '#4b6b60', heroFrom: '#064e3b', heroTo: '#0f766e', heroInk: '#ffffff' }),
        theme('royal', 'Royal purple', { primary: '#4c1d95', accent: '#ec4899', background: '#f8f6fd', surface: '#ffffff', ink: '#1e1035', muted: '#625a78', heroFrom: '#3b0764', heroTo: '#6d28d9', heroInk: '#ffffff' }),
        theme('ocean', 'Ocean', { primary: '#075985', accent: '#22d3ee', background: '#f3f9fc', surface: '#ffffff', ink: '#082032', muted: '#4f6b7d', heroFrom: '#0c4a6e', heroTo: '#0369a1', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Digital products,', accent: 'delivered fast.', subtitle: 'Gift cards, top-ups, bills and more, paid the way that suits you.' },
        { id: id(), type: 'product_rail', span: full, title: 'Popular now', subtitle: 'What customers are buying.', source: 'trending', limit: 8, filters: true, viewAllHref: '/catalogs' },
        { id: id(), type: 'category_grid', span: full, title: 'Shop by category', subtitle: 'Everything in one place.' },
        { id: id(), type: 'brand_grid', span: full, title: 'Brands', subtitle: 'Find the brands you love.', limit: 12 },
        { id: id(), type: 'product_rail', span: full, title: 'New in store', subtitle: 'The latest additions.', source: 'new', limit: 8, viewAllHref: '/catalogs' },
        everyday,
      ],
    },
    {
      key: 'bold',
      name: 'Bold',
      description: 'A bright gradient hero with big category tiles beside it, promos and a top-up form up front.',
      style: { mode: 'light', hero: 'gradient', corners: 'round', cards: 'flat', font: 'display', density: 'comfortable' },
      themes: [
        theme('sunset', 'Sunset', { primary: '#ea580c', accent: '#db2777', background: '#fff8f3', surface: '#ffffff', ink: '#2a1206', muted: '#7a5a4a', heroFrom: '#f97316', heroTo: '#db2777', heroInk: '#ffffff' }),
        theme('electric', 'Electric', { primary: '#4338ca', accent: '#06b6d4', background: '#f5f6ff', surface: '#ffffff', ink: '#111433', muted: '#5a5f85', heroFrom: '#4338ca', heroTo: '#06b6d4', heroInk: '#ffffff' }),
        theme('lime', 'Lime', { primary: '#3f6212', accent: '#facc15', background: '#f9fbf1', surface: '#ffffff', ink: '#1a2406', muted: '#5f6b48', heroFrom: '#65a30d', heroTo: '#15803d', heroInk: '#ffffff' }),
        theme('berry', 'Berry', { primary: '#9d174d', accent: '#7c3aed', background: '#fdf4f8', surface: '#ffffff', ink: '#2b0a1a', muted: '#7a5466', heroFrom: '#be185d', heroTo: '#7c3aed', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: { lg: 8, md: 6 }, title: 'Shop it.', accent: 'Get it in minutes.', subtitle: 'Top-ups, gift cards, bills and travel data in one place.', categoryChips: false },
        { id: id(), type: 'category_grid', span: { lg: 4, md: 6 }, title: 'Jump in', categories: ['gift_cards', 'airtime', 'data', 'bills'] },
        { id: id(), type: 'quick_buy', span: full, title: 'Top up now', subtitle: 'Airtime and data in seconds.', categories: ['airtime', 'data'] },
        { id: id(), type: 'product_rail', span: { lg: 8, md: 6, rows: 2 }, title: 'Hot right now', subtitle: 'Most bought this week.', source: 'trending', limit: 6 },
        { id: id(), type: 'promo', span: third, title: 'Gift cards', subtitle: 'For every occasion', cta: { label: 'Browse gift cards', href: '/catalogs/gift_cards' }, theme: 'pink', illustration: 'gift' },
        { id: id(), type: 'promo', span: third, title: 'Travelling?', subtitle: 'eSIM data, ready before you land', cta: { label: 'Browse eSIMs', href: '/catalogs/esim' }, theme: 'sky', illustration: 'esim' },
        { id: id(), type: 'brand_grid', span: full, title: 'Top brands', limit: 12 },
        everyday,
      ],
    },
    {
      key: 'minimal',
      name: 'Minimal',
      description: 'White space, a plain headline with search, and products as clean lists.',
      style: { mode: 'light', hero: 'minimal', corners: 'soft', cards: 'outline', font: 'sans', density: 'airy' },
      themes: [
        theme('ink', 'Ink', { primary: '#111827', accent: '#2563eb', background: '#ffffff', surface: '#ffffff', ink: '#111827', muted: '#6b7280', heroFrom: '#ffffff', heroTo: '#f3f4f6', heroInk: '#111827' }),
        theme('sand', 'Sand', { primary: '#78350f', accent: '#b45309', background: '#fdfbf7', surface: '#ffffff', ink: '#292018', muted: '#7c6f60', heroFrom: '#fdfbf7', heroTo: '#f5ecdd', heroInk: '#292018' }),
        theme('mint', 'Mint', { primary: '#0f766e', accent: '#10b981', background: '#fbfefd', surface: '#ffffff', ink: '#0f2a27', muted: '#5c7470', heroFrom: '#fbfefd', heroTo: '#e6f7f3', heroInk: '#0f2a27' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Everything digital.', accent: '', subtitle: 'Search gift cards, top-ups, bills and more.', categoryChips: false },
        { id: id(), type: 'category_grid', span: full, title: 'Categories' },
        { id: id(), type: 'product_rail', span: half, title: 'Popular', source: 'trending', limit: 6, layout: 'list', viewAllHref: '/catalogs' },
        { id: id(), type: 'product_rail', span: half, title: 'New', source: 'new', limit: 6, layout: 'list', viewAllHref: '/catalogs' },
        { id: id(), type: 'brand_grid', span: full, title: 'Brands', limit: 12 },
      ],
    },
  ],
};

// -- 2. Top-up and bills ----------------------------------------------------------------------------------------------

const topupCategories: ProductCategory[] = ['airtime', 'data', 'bills', 'pay_tv', 'mobile_money'];
const topupTrust = trust([
  ['bolt', 'Instant top-ups', 'Most top-ups land in seconds.'],
  ['shield', 'Checked before you pay', 'We confirm the number, meter or smartcard first.'],
  ['card', 'Pay your way', 'Card, bank or mobile money.'],
  ['clock', 'Day and night', 'Buy any time, every day.'],
]);

const topups: StoreTemplate = {
  key: 'topups',
  name: 'Top-up and bills',
  tagline: 'Airtime, data, electricity and TV, paid in seconds.',
  description: 'A store for everyday top-ups and bills: a quick-buy form up front, the networks and billers, and the popular bundles.',
  categories: topupCategories,
  single: false,
  sections: ['hero', 'quick_buy', 'brand_grid', 'product_rail', 'category_grid', 'promo', 'trust_bar', 'features', 'faq'],
  variants: [
    {
      key: 'quick_buy',
      name: 'Quick buy',
      description: 'The top-up form is the hero: network, number and amount, then popular bundles.',
      style: { mode: 'light', hero: 'quick_buy', corners: 'round', cards: 'raised', font: 'sans', density: 'compact' },
      themes: [
        theme('sunshine', 'Sunshine', { primary: '#a16207', accent: '#facc15', background: '#fffdf2', surface: '#ffffff', ink: '#231c03', muted: '#6f6440', heroFrom: '#facc15', heroTo: '#f59e0b', heroInk: '#231c03' }),
        theme('signal_red', 'Signal red', { primary: '#b91c1c', accent: '#f97316', background: '#fff6f5', surface: '#ffffff', ink: '#2a0a08', muted: '#7a5250', heroFrom: '#dc2626', heroTo: '#9f1239', heroInk: '#ffffff' }),
        theme('lime_green', 'Lime green', { primary: '#15803d', accent: '#84cc16', background: '#f5fcf5', surface: '#ffffff', ink: '#0b2513', muted: '#4f6b56', heroFrom: '#16a34a', heroTo: '#65a30d', heroInk: '#ffffff' }),
        theme('night_sky', 'Night sky', { primary: '#1e3a8a', accent: '#38bdf8', background: '#f4f7fd', surface: '#ffffff', ink: '#0b1430', muted: '#55607f', heroFrom: '#0f172a', heroTo: '#1e3a8a', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'quick_buy', span: full, title: 'Top up in seconds', subtitle: 'Choose what you need, enter the number and pay.', categories: ['airtime', 'data', 'bills', 'pay_tv'] },
        { id: id(), type: 'product_rail', span: full, title: 'Popular data bundles', source: 'category', category: 'data', limit: 8, viewAllHref: '/catalogs/data' },
        { id: id(), type: 'brand_grid', span: full, title: 'Networks', categories: ['airtime', 'data'], limit: 12 },
        topupTrust,
      ],
    },
    {
      key: 'networks',
      name: 'Network wall',
      description: 'Every network and biller as a big tile first, so customers start from their provider.',
      style: { mode: 'light', hero: 'networks', corners: 'soft', cards: 'outline', font: 'display', density: 'comfortable' },
      themes: [
        theme('clean_blue', 'Clean blue', { primary: '#1d4ed8', accent: '#f59e0b', background: '#f7f9fe', surface: '#ffffff', ink: '#0d1a3a', muted: '#58648a', heroFrom: '#eff4ff', heroTo: '#dbe6ff', heroInk: '#0d1a3a' }),
        theme('teal', 'Teal', { primary: '#0f766e', accent: '#f43f5e', background: '#f4fbfa', surface: '#ffffff', ink: '#082624', muted: '#4c6b68', heroFrom: '#e6f6f4', heroTo: '#ccefe9', heroInk: '#082624' }),
        theme('graphite', 'Graphite', { primary: '#334155', accent: '#eab308', background: '#f8fafc', surface: '#ffffff', ink: '#0f172a', muted: '#64748b', heroFrom: '#f1f5f9', heroTo: '#e2e8f0', heroInk: '#0f172a' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Pick your network,', accent: 'we do the rest.', subtitle: 'Airtime, data, electricity and TV for every provider.', search: false, categoryChips: true },
        { id: id(), type: 'brand_grid', span: full, title: 'Mobile networks', categories: ['airtime', 'data'], limit: 12 },
        { id: id(), type: 'brand_grid', span: full, title: 'Electricity and TV', categories: ['bills', 'pay_tv'], limit: 12 },
        { id: id(), type: 'quick_buy', span: full, title: 'Know what you need?', subtitle: 'Buy it here.', categories: ['airtime', 'data'] },
        topupTrust,
      ],
    },
    {
      key: 'bills_hub',
      name: 'Bills hub',
      description: 'Built around paying bills: electricity and TV first, with reminders of what each needs.',
      style: { mode: 'dark', hero: 'billers', corners: 'round', cards: 'glass', font: 'sans', density: 'comfortable' },
      themes: [
        theme('midnight', 'Midnight', { primary: '#38bdf8', accent: '#facc15', background: '#0b1120', surface: '#131c31', ink: '#e8eefc', muted: '#94a3c4', heroFrom: '#0b1120', heroTo: '#1e293b', heroInk: '#ffffff' }),
        theme('forest_night', 'Forest night', { primary: '#4ade80', accent: '#fbbf24', background: '#07130d', surface: '#0f2218', ink: '#e6f5ec', muted: '#93b3a0', heroFrom: '#07130d', heroTo: '#14532d', heroInk: '#ffffff' }),
        theme('plum_night', 'Plum night', { primary: '#e879f9', accent: '#fb7185', background: '#140a1c', surface: '#22122f', ink: '#f6eafc', muted: '#b59cc4', heroFrom: '#140a1c', heroTo: '#4a1d63', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'quick_buy', span: full, title: 'Pay a bill', subtitle: 'Electricity tokens and TV subscriptions, confirmed before you pay.', categories: ['bills', 'pay_tv', 'airtime'] },
        { id: id(), type: 'brand_grid', span: full, title: 'Billers', categories: ['bills', 'pay_tv'], limit: 12 },
        {
          id: id(),
          type: 'features',
          span: full,
          title: 'How it works',
          items: [
            { icon: 'phone', title: 'Enter your number', body: 'Your meter, smartcard or phone number.' },
            { icon: 'shield', title: 'We check it', body: 'You see the account name before paying.' },
            { icon: 'bolt', title: 'Done', body: 'Your token or confirmation arrives at once.' },
          ],
        },
        topupTrust,
      ],
    },
  ],
};

// -- 3. Gift card shop ------------------------------------------------------------------------------------------------

const giftTrust = trust([
  ['gift', 'Genuine cards', 'From authorised suppliers only.'],
  ['bolt', 'Delivered by email', 'Your code arrives in minutes.'],
  ['lock', 'Codes kept safe', 'Shown only to you, when you ask.'],
  ['support', 'Help with redeeming', 'Step-by-step for every brand.'],
]);

const giftCards: StoreTemplate = {
  key: 'gift_cards',
  name: 'Gift card shop',
  tagline: 'Gift cards for every brand and occasion.',
  description: 'A shop for gift cards: brand card art front and centre, trending cards and occasions.',
  categories: ['gift_cards'],
  single: false,
  sections: ['hero', 'brand_grid', 'product_rail', 'promo', 'trust_bar', 'features', 'faq'],
  variants: [
    {
      key: 'card_wall',
      name: 'Card wall',
      description: 'A wall of brand cards in the hero, then trending cards and brands by tag.',
      style: { mode: 'light', hero: 'card_wall', corners: 'round', cards: 'raised', font: 'display', density: 'comfortable' },
      themes: [
        theme('candy', 'Candy', { primary: '#db2777', accent: '#7c3aed', background: '#fff7fb', surface: '#ffffff', ink: '#2a0b1c', muted: '#7d5a6c', heroFrom: '#fce7f3', heroTo: '#ede9fe', heroInk: '#2a0b1c' }),
        theme('confetti', 'Confetti', { primary: '#2563eb', accent: '#f97316', background: '#f7f9ff', surface: '#ffffff', ink: '#0f1a3d', muted: '#5a6488', heroFrom: '#dbeafe', heroTo: '#ffedd5', heroInk: '#0f1a3d' }),
        theme('festive', 'Festive', { primary: '#b91c1c', accent: '#15803d', background: '#fffaf7', surface: '#ffffff', ink: '#2b0c08', muted: '#7a5b52', heroFrom: '#fee2e2', heroTo: '#dcfce7', heroInk: '#2b0c08' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'The perfect gift,', accent: 'in their inbox.', subtitle: 'Gift cards for shopping, gaming, streaming and more.', categoryChips: false },
        { id: id(), type: 'product_rail', span: full, title: 'Trending gift cards', source: 'trending', limit: 8, filters: true, viewAllHref: '/catalogs/gift_cards' },
        { id: id(), type: 'brand_grid', span: full, title: 'Shop by brand', limit: 18 },
        { id: id(), type: 'brand_grid', span: half, title: 'For gamers', tag: 'gaming', limit: 6 },
        { id: id(), type: 'brand_grid', span: half, title: 'Streaming', tag: 'streaming', limit: 6 },
        giftTrust,
      ],
    },
    {
      key: 'boutique',
      name: 'Boutique',
      description: 'An elegant, editorial shop: a featured brand, occasions and a handful of hand-picked cards.',
      style: { mode: 'light', hero: 'boutique', corners: 'sharp', cards: 'outline', font: 'serif', density: 'airy' },
      themes: [
        theme('champagne', 'Champagne', { primary: '#7c5a1d', accent: '#c08a2e', background: '#fcfaf5', surface: '#ffffff', ink: '#231b0d', muted: '#7a6d57', heroFrom: '#f7f0e1', heroTo: '#ead9b5', heroInk: '#231b0d' }),
        theme('blush', 'Blush', { primary: '#9f1239', accent: '#e11d48', background: '#fffafb', surface: '#ffffff', ink: '#2a0a14', muted: '#7d5c66', heroFrom: '#fff1f2', heroTo: '#fecdd3', heroInk: '#2a0a14' }),
        theme('noir', 'Noir', { primary: '#111111', accent: '#b8860b', background: '#fafafa', surface: '#ffffff', ink: '#111111', muted: '#6b6b6b', heroFrom: '#1a1a1a', heroTo: '#3a3a3a', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Give something', accent: 'they will love.', subtitle: 'A curated selection of gift cards.', search: false, categoryChips: false },
        { id: id(), type: 'promo', span: half, title: 'Birthdays', subtitle: 'Cards they will actually use', theme: 'light', illustration: 'gift', cta: { label: 'Find a card', href: '/catalogs/gift_cards' } },
        { id: id(), type: 'promo', span: half, title: 'Thank you', subtitle: 'Say it with a gift', theme: 'navy', illustration: 'gift', cta: { label: 'Find a card', href: '/catalogs/gift_cards' } },
        { id: id(), type: 'product_rail', span: full, title: 'Our favourites', source: 'top_selling', limit: 6 },
        { id: id(), type: 'brand_grid', span: full, title: 'The brands', limit: 12 },
        giftTrust,
      ],
    },
    {
      key: 'gamer',
      name: 'Gamer',
      description: 'Dark and neon for gaming and entertainment cards: top-ups for every platform.',
      style: { mode: 'dark', hero: 'neon', corners: 'sharp', cards: 'glass', font: 'mono', density: 'compact' },
      themes: [
        theme('neon_green', 'Neon green', { primary: '#22c55e', accent: '#a855f7', background: '#07090d', surface: '#11151d', ink: '#e7ffe9', muted: '#8fa497', heroFrom: '#07090d', heroTo: '#0f2b18', heroInk: '#ffffff' }),
        theme('cyber_pink', 'Cyber pink', { primary: '#f472b6', accent: '#22d3ee', background: '#0a0710', surface: '#160f22', ink: '#fdeaf5', muted: '#ad97b3', heroFrom: '#0a0710', heroTo: '#3b0a3a', heroInk: '#ffffff' }),
        theme('arcade_blue', 'Arcade blue', { primary: '#60a5fa', accent: '#facc15', background: '#060912', surface: '#0f1526', ink: '#e8f0ff', muted: '#91a0bf', heroFrom: '#060912', heroTo: '#172554', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Level up.', accent: 'Instantly.', subtitle: 'Gaming, streaming and app store cards.', categoryChips: false },
        { id: id(), type: 'brand_grid', span: full, title: 'Platforms', tag: 'gaming', limit: 12 },
        { id: id(), type: 'product_rail', span: full, title: 'Most wanted', source: 'trending', limit: 8 },
        { id: id(), type: 'brand_grid', span: full, title: 'Streaming and apps', tag: 'streaming', limit: 12 },
        giftTrust,
      ],
    },
  ],
};

// -- 4. Single product ------------------------------------------------------------------------------------------------

const singleProduct: StoreTemplate = {
  key: 'single_product',
  name: 'Single product',
  tagline: 'One product, one page, one buy button.',
  description: 'A landing page for one product or brand: an eSIM plan, a virtual number, one gift card brand or a bundle. The buy form sits above the fold.',
  categories: null,
  single: true,
  sections: ['product_spotlight', 'hero', 'features', 'faq', 'promo', 'trust_bar'],
  variants: [
    {
      key: 'spotlight',
      name: 'Spotlight',
      description: 'The product and its buy form fill the first screen, then its features.',
      style: { mode: 'light', hero: 'spotlight', corners: 'round', cards: 'raised', font: 'display', density: 'comfortable' },
      themes: [
        theme('flamingo', 'Flamingo', { primary: '#e11d74', accent: '#070f4c', background: '#fff7fa', surface: '#ffffff', ink: '#1f0a15', muted: '#7a5a6a', heroFrom: '#ffe4ef', heroTo: '#ffffff', heroInk: '#1f0a15' }),
        theme('sky', 'Sky', { primary: '#0284c7', accent: '#0f172a', background: '#f5fbff', surface: '#ffffff', ink: '#082032', muted: '#557085', heroFrom: '#e0f2fe', heroTo: '#ffffff', heroInk: '#082032' }),
        theme('citrus', 'Citrus', { primary: '#ca8a04', accent: '#15803d', background: '#fffdf5', surface: '#ffffff', ink: '#231c04', muted: '#776c45', heroFrom: '#fef9c3', heroTo: '#ffffff', heroInk: '#231c04' }),
      ],
      starter: () => [
        { id: id(), type: 'product_spotlight', span: full, bullets: ['Delivered in minutes', 'Pay the way that suits you', 'Help if anything goes wrong'] },
        {
          id: id(),
          type: 'features',
          span: full,
          title: 'Why buy here',
          items: [
            { icon: 'bolt', title: 'Fast', body: 'Delivered in minutes.' },
            { icon: 'lock', title: 'Secure', body: 'Checkout you can trust.' },
            { icon: 'support', title: 'Supported', body: 'We are here to help.' },
          ],
        },
        everyday,
      ],
    },
    {
      key: 'split',
      name: 'Split',
      description: 'A big image on one side and the buy form on the other, product details below.',
      style: { mode: 'light', hero: 'split', corners: 'soft', cards: 'outline', font: 'sans', density: 'comfortable' },
      themes: [
        theme('charcoal', 'Charcoal', { primary: '#1f2937', accent: '#f43f5e', background: '#ffffff', surface: '#f9fafb', ink: '#111827', muted: '#6b7280', heroFrom: '#f3f4f6', heroTo: '#ffffff', heroInk: '#111827' }),
        theme('lagoon', 'Lagoon', { primary: '#0e7490', accent: '#f59e0b', background: '#ffffff', surface: '#f5fbfc', ink: '#062830', muted: '#58737a', heroFrom: '#ecfeff', heroTo: '#ffffff', heroInk: '#062830' }),
        theme('violet', 'Violet', { primary: '#6d28d9', accent: '#10b981', background: '#ffffff', surface: '#faf8ff', ink: '#1c1033', muted: '#665d7d', heroFrom: '#f5f3ff', heroTo: '#ffffff', heroInk: '#1c1033' }),
      ],
      starter: () => [
        { id: id(), type: 'product_spotlight', span: full, bullets: ['Delivered digitally', 'Secure checkout'] },
        everyday,
        {
          id: id(),
          type: 'faq',
          span: full,
          title: 'Questions',
          items: [
            { question: 'How do I receive it?', answer: 'Right after payment, on your order page and by email where the product allows.' },
            { question: 'How can I pay?', answer: 'With the payment methods shown at checkout for your country.' },
          ],
        },
      ],
    },
    {
      key: 'story',
      name: 'Story',
      description: 'A long, scrolling landing page that tells the product’s story before the buy form.',
      style: { mode: 'dark', hero: 'story', corners: 'round', cards: 'glass', font: 'display', density: 'airy' },
      themes: [
        theme('deep_space', 'Deep space', { primary: '#818cf8', accent: '#f472b6', background: '#070814', surface: '#11132a', ink: '#eef0ff', muted: '#9ea3c9', heroFrom: '#070814', heroTo: '#1e1b4b', heroInk: '#ffffff' }),
        theme('ember', 'Ember', { primary: '#fb923c', accent: '#facc15', background: '#120804', surface: '#22120a', ink: '#fff1e6', muted: '#c3a28c', heroFrom: '#120804', heroTo: '#431407', heroInk: '#ffffff' }),
        theme('jade', 'Jade', { primary: '#34d399', accent: '#60a5fa', background: '#04110c', surface: '#0a2018', ink: '#e7fbf2', muted: '#93bba9', heroFrom: '#04110c', heroTo: '#064e3b', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Made for', accent: 'the way you live.', subtitle: 'Everything you need to know, then one tap to buy.', search: false, categoryChips: false },
        {
          id: id(),
          type: 'features',
          span: full,
          title: 'What you get',
          items: [
            { icon: 'star', title: 'Quality', body: 'From authorised suppliers.' },
            { icon: 'globe', title: 'Anywhere', body: 'Bought and delivered online.' },
            { icon: 'bolt', title: 'Instant', body: 'Yours in minutes.' },
          ],
        },
        { id: id(), type: 'product_spotlight', span: full, title: 'Get yours', bullets: [] },
        everyday,
      ],
    },
  ],
};

// -- 5. VPN shop ------------------------------------------------------------------------------------------------------

// Only what BitoCard's VPN access is (30 days, up to 10 devices, never renewed by itself, details on the order page):
// no privacy, logging, location or speed claims until they are evidenced (see VPN access in AGENTS.md).
const vpnFeatures = (title: string) => ({
  id: id(),
  type: 'features',
  span: full,
  title,
  items: [
    { icon: 'clock', title: '30 days of access', body: 'From the day you buy.' },
    { icon: 'phone', title: 'Up to 10 devices', body: 'Your phone, laptop, tablet and more.' },
    { icon: 'shield', title: 'No surprise renewals', body: 'It never renews by itself. Buy again when you want more.' },
    { icon: 'lock', title: 'Your sign-in details', body: 'On your order page, shown only to you.' },
  ],
});
const vpnFaq = {
  id: id(),
  type: 'faq',
  span: full,
  title: 'Questions',
  items: [
    { question: 'How long does it last?', answer: '30 days from the day you buy it.' },
    { question: 'Does it renew automatically?', answer: 'No. When the 30 days are up it simply ends; buy again whenever you want more.' },
    { question: 'How many devices can I use?', answer: 'Up to 10 devices with the same sign-in details.' },
    { question: 'Where are my sign-in details?', answer: 'On your order page, once you have paid.' },
  ],
};
const vpnTrust = trust([
  ['lock', 'Secure checkout', 'Your information is protected.'],
  ['bolt', 'Ready after payment', 'Your sign-in details are on your order page.'],
  ['clock', 'No subscription', 'Pay once for 30 days.'],
  ['support', 'Help setting up', 'We are here if anything goes wrong.'],
]);

const vpnShop: StoreTemplate = {
  key: 'vpn_shop',
  name: 'VPN shop',
  tagline: 'VPN access, ready to use after payment.',
  description: 'A store for VPN access only: the plan and its buy form up front, what it includes and the questions customers ask.',
  categories: ['vpn'],
  single: false,
  sections: ['hero', 'product_spotlight', 'product_rail', 'features', 'faq', 'promo', 'trust_bar'],
  variants: [
    {
      key: 'shield',
      name: 'Shield',
      description: 'A big shield beside the headline, then the plan with its buy form and what it includes.',
      style: { mode: 'light', hero: 'shield', corners: 'round', cards: 'raised', font: 'display', density: 'comfortable' },
      themes: [
        theme('guard_blue', 'Guard blue', { primary: '#1d4ed8', accent: '#10b981', background: '#f5f8ff', surface: '#ffffff', ink: '#0b1736', muted: '#56627f', heroFrom: '#1e3a8a', heroTo: '#2563eb', heroInk: '#ffffff' }),
        theme('safe_green', 'Safe green', { primary: '#047857', accent: '#0ea5e9', background: '#f3fbf7', surface: '#ffffff', ink: '#06261b', muted: '#4b6b5e', heroFrom: '#064e3b', heroTo: '#059669', heroInk: '#ffffff' }),
        theme('violet_lock', 'Violet lock', { primary: '#6d28d9', accent: '#f472b6', background: '#f9f7ff', surface: '#ffffff', ink: '#1c1033', muted: '#665d7d', heroFrom: '#4c1d95', heroTo: '#7c3aed', heroInk: '#ffffff' }),
        theme('coral', 'Coral', { primary: '#e11d48', accent: '#070f4c', background: '#fff7f8', surface: '#ffffff', ink: '#2a0a12', muted: '#7d5c65', heroFrom: '#9f1239', heroTo: '#e11d48', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Browse your way,', accent: 'on every device.', subtitle: 'VPN access for 30 days on up to 10 devices. No subscription.', search: false, categoryChips: false },
        { id: id(), type: 'product_spotlight', span: full, title: 'Get VPN access', bullets: ['30 days from the day you buy', 'Up to 10 devices', 'Never renews by itself'] },
        vpnFeatures('What you get'),
        vpnFaq,
        vpnTrust,
      ],
    },
    {
      key: 'devices',
      name: 'Every device',
      description: 'Light and friendly: the devices it works on in the hero, then the plan and plain answers.',
      style: { mode: 'light', hero: 'devices', corners: 'soft', cards: 'outline', font: 'sans', density: 'airy' },
      themes: [
        theme('cloud', 'Cloud', { primary: '#0369a1', accent: '#f59e0b', background: '#ffffff', surface: '#f7fafc', ink: '#0b2133', muted: '#58707f', heroFrom: '#e0f2fe', heroTo: '#ffffff', heroInk: '#0b2133' }),
        theme('mint_leaf', 'Mint leaf', { primary: '#0f766e', accent: '#e11d74', background: '#ffffff', surface: '#f5fbfa', ink: '#082624', muted: '#567370', heroFrom: '#ccfbf1', heroTo: '#ffffff', heroInk: '#082624' }),
        theme('apricot', 'Apricot', { primary: '#c2410c', accent: '#1d4ed8', background: '#ffffff', surface: '#fffaf6', ink: '#2a1206', muted: '#7d6152', heroFrom: '#ffedd5', heroTo: '#ffffff', heroInk: '#2a1206' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'One plan,', accent: 'up to 10 devices.', subtitle: 'Phones, laptops and tablets on the same sign-in details for 30 days.', search: false, categoryChips: false },
        vpnFeatures('Simple by design'),
        { id: id(), type: 'product_spotlight', span: full, title: 'Ready when you are', bullets: ['Pay once', 'Sign-in details on your order page'] },
        vpnFaq,
      ],
    },
    {
      key: 'tunnel',
      name: 'Night tunnel',
      description: 'Dark and glowing: light trails through a tunnel, the plan on glass cards.',
      style: { mode: 'dark', hero: 'tunnel', corners: 'round', cards: 'glass', font: 'display', density: 'comfortable' },
      themes: [
        theme('cyan_glow', 'Cyan glow', { primary: '#22d3ee', accent: '#a78bfa', background: '#050b14', surface: '#0d1828', ink: '#e6f6ff', muted: '#8ea5bd', heroFrom: '#050b14', heroTo: '#0c2a45', heroInk: '#ffffff' }),
        theme('aurora_green', 'Aurora green', { primary: '#4ade80', accent: '#22d3ee', background: '#04100b', surface: '#0b1f17', ink: '#e7fbf0', muted: '#93b7a4', heroFrom: '#04100b', heroTo: '#0f3d2a', heroInk: '#ffffff' }),
        theme('magenta_night', 'Magenta night', { primary: '#f472b6', accent: '#facc15', background: '#0c0610', surface: '#1a0f22', ink: '#fdeaf5', muted: '#b39cb8', heroFrom: '#0c0610', heroTo: '#3d0b3b', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Your connection,', accent: 'your way.', subtitle: 'VPN access for 30 days on up to 10 devices.', search: false, categoryChips: false },
        { id: id(), type: 'product_spotlight', span: full, bullets: ['30 days', 'Up to 10 devices', 'No subscription'] },
        vpnFaq,
        vpnTrust,
      ],
    },
  ],
};

// -- 6. RDP shop ------------------------------------------------------------------------------------------------------

const rdpFeatures = {
  id: id(),
  type: 'features',
  span: full,
  title: 'How it works',
  items: [
    { icon: 'star', title: 'Choose a server', body: 'Pick the plan that fits what you run.' },
    { icon: 'lock', title: 'Get your details', body: 'Connection details on your order page, shown only to you.' },
    { icon: 'globe', title: 'Connect from anywhere', body: 'With a Remote Desktop app on your computer, phone or tablet.' },
  ],
};
const rdpFaq = {
  id: id(),
  type: 'faq',
  span: full,
  title: 'Questions',
  items: [
    { question: 'What is an RDP server?', answer: 'A computer in a data centre that you use from your own device over Remote Desktop.' },
    { question: 'How do I connect?', answer: 'Open a Remote Desktop app and enter the details from your order page.' },
    { question: 'Which devices can I connect from?', answer: 'Windows, Mac, iPhone, iPad and Android all have Remote Desktop apps.' },
  ],
};
const rdpTrust = trust([
  ['lock', 'Secure checkout', 'Your information is protected.'],
  ['bolt', 'Digital delivery', 'Connection details on your order page.'],
  ['globe', 'Use it anywhere', 'From any device with a Remote Desktop app.'],
  ['support', 'Help connecting', 'We are here if anything goes wrong.'],
]);

const rdpShop: StoreTemplate = {
  key: 'rdp_shop',
  name: 'RDP shop',
  tagline: 'Remote desktop servers, ready to connect.',
  description: 'A store for RDP servers only: the plans side by side, how connecting works and the questions customers ask.',
  categories: ['rdp'],
  single: false,
  sections: ['hero', 'product_rail', 'product_spotlight', 'features', 'faq', 'promo', 'trust_bar'],
  variants: [
    {
      key: 'desktop',
      name: 'Desktop window',
      description: 'A remote desktop window drawn beside the headline, then the plans and how to connect.',
      style: { mode: 'light', hero: 'desktop', corners: 'round', cards: 'raised', font: 'sans', density: 'comfortable' },
      themes: [
        theme('azure', 'Azure', { primary: '#0063b1', accent: '#ff2382', background: '#f4f8fc', surface: '#ffffff', ink: '#0a1a2e', muted: '#55677c', heroFrom: '#0b3d91', heroTo: '#0078d4', heroInk: '#ffffff' }),
        theme('slate_orange', 'Slate and orange', { primary: '#334155', accent: '#f97316', background: '#f8fafc', surface: '#ffffff', ink: '#0f172a', muted: '#64748b', heroFrom: '#1e293b', heroTo: '#475569', heroInk: '#ffffff' }),
        theme('indigo', 'Indigo', { primary: '#4338ca', accent: '#22c55e', background: '#f6f6ff', surface: '#ffffff', ink: '#13123a', muted: '#5d5f88', heroFrom: '#312e81', heroTo: '#4f46e5', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Your desktop,', accent: 'in the cloud.', subtitle: 'Remote desktop servers you can reach from any device.', search: false, categoryChips: false },
        { id: id(), type: 'product_rail', span: full, title: 'Server plans', source: 'category', category: 'rdp', limit: 8, viewAllHref: '/catalogs/rdp' },
        rdpFeatures,
        rdpFaq,
        rdpTrust,
      ],
    },
    {
      key: 'rack',
      name: 'Server rack',
      description: 'Dark and technical: a lit server rack in the hero, the plans as a list.',
      style: { mode: 'dark', hero: 'rack', corners: 'sharp', cards: 'flat', font: 'mono', density: 'compact' },
      themes: [
        theme('datacentre', 'Data centre', { primary: '#38bdf8', accent: '#22c55e', background: '#060a10', surface: '#0e1520', ink: '#e6eef8', muted: '#8b9bb0', heroFrom: '#060a10', heroTo: '#10233a', heroInk: '#ffffff' }),
        theme('amber_led', 'Amber LED', { primary: '#f59e0b', accent: '#ef4444', background: '#0a0805', surface: '#17120b', ink: '#fbf3e4', muted: '#a99e88', heroFrom: '#0a0805', heroTo: '#2d1f08', heroInk: '#ffffff' }),
        theme('green_led', 'Green LED', { primary: '#22c55e', accent: '#38bdf8', background: '#05090a', surface: '#0d1614', ink: '#e6f5ee', muted: '#8aa59a', heroFrom: '#05090a', heroTo: '#0d2a1d', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Servers', accent: 'ready to connect.', subtitle: 'Pick a plan, pay, and connect with the details on your order page.', search: false, categoryChips: false },
        { id: id(), type: 'product_rail', span: full, title: 'Plans', source: 'category', category: 'rdp', limit: 8, layout: 'list', viewAllHref: '/catalogs/rdp' },
        rdpFaq,
        rdpTrust,
      ],
    },
    {
      key: 'blueprint',
      name: 'Blueprint',
      description: 'Clean lines on a blueprint grid, one featured plan with its buy form, then the rest.',
      style: { mode: 'light', hero: 'blueprint', corners: 'soft', cards: 'outline', font: 'display', density: 'airy' },
      themes: [
        theme('blueprint_blue', 'Blueprint blue', { primary: '#1e40af', accent: '#f59e0b', background: '#ffffff', surface: '#f7f9fe', ink: '#0d1a3a', muted: '#58648a', heroFrom: '#eef3ff', heroTo: '#ffffff', heroInk: '#0d1a3a' }),
        theme('graph_paper', 'Graph paper', { primary: '#111827', accent: '#e11d48', background: '#ffffff', surface: '#fafafa', ink: '#111827', muted: '#6b7280', heroFrom: '#f4f4f5', heroTo: '#ffffff', heroInk: '#111827' }),
        theme('teal_line', 'Teal line', { primary: '#0f766e', accent: '#7c3aed', background: '#ffffff', surface: '#f6fbfa', ink: '#082624', muted: '#567370', heroFrom: '#e6f6f4', heroTo: '#ffffff', heroInk: '#082624' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Built for', accent: 'getting work done.', subtitle: 'Remote desktop servers, delivered online.', search: false, categoryChips: false },
        { id: id(), type: 'product_spotlight', span: full, title: 'Featured plan', bullets: ['Connection details on your order page', 'Use it from any device'] },
        { id: id(), type: 'product_rail', span: full, title: 'All plans', source: 'category', category: 'rdp', limit: 8, viewAllHref: '/catalogs/rdp' },
        rdpFeatures,
        rdpFaq,
      ],
    },
  ],
};

// -- 7. Resale shop (B2B reselling: BitoCard Shop suppliers' listings) -------------------------------------------------

const resaleTrust = trust([
  ['shield', 'Payment protected', 'Your money is held until you have the item.'],
  ['star', 'Checked sellers', 'Every item comes from a named, checked supplier.'],
  ['card', 'Pay from your wallet', 'No card details shared with anyone.'],
  ['support', 'Help when you need it', 'We are here if anything goes wrong.'],
]);
const resaleFaq = {
  id: id(),
  type: 'faq',
  span: full,
  title: 'Questions',
  items: [
    { question: 'Who sends me the item?', answer: 'The supplier named on each listing. They hand it over at a meet-up or send it to you.' },
    { question: 'When does the seller get paid?', answer: 'Only once you have the item. Your money is held safely until then.' },
    { question: 'What if something goes wrong?', answer: 'Tell us before you confirm you have the item. Your money stays held while it is sorted out.' },
  ],
};

const resaleShop: StoreTemplate = {
  key: 'resale_shop',
  name: 'Resale shop',
  tagline: 'Sell checked suppliers’ products under your brand.',
  description: 'Phones, electronics, fashion and more from Udozo suppliers in your country, at your prices. Every listing shows its supplier, and buyers’ money is held until they have the item.',
  categories: [],
  single: false,
  resale: true,
  sections: ['hero', 'listing_rail', 'listing_grid', 'resale_categories', 'promo', 'features', 'faq', 'trust_bar'],
  variants: [
    {
      key: 'showroom',
      name: 'Showroom',
      description: 'A mosaic of your listings’ photos beside the headline, then the newest arrivals and categories.',
      style: { mode: 'light', hero: 'showroom', corners: 'round', cards: 'raised', font: 'display', density: 'comfortable' },
      themes: [
        theme('ink_coral', 'Ink and coral', { primary: '#e11d48', accent: '#070f4c', background: '#fafafa', surface: '#ffffff', ink: '#111827', muted: '#6b7280', heroFrom: '#111827', heroTo: '#1f2937', heroInk: '#ffffff' }),
        theme('ocean', 'Ocean', { primary: '#0369a1', accent: '#f59e0b', background: '#f5f9fc', surface: '#ffffff', ink: '#0b2133', muted: '#58707f', heroFrom: '#0c4a6e', heroTo: '#0369a1', heroInk: '#ffffff' }),
        theme('forest', 'Forest', { primary: '#15803d', accent: '#c2410c', background: '#f6faf6', surface: '#ffffff', ink: '#0d2614', muted: '#4f6b57', heroFrom: '#14532d', heroTo: '#15803d', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Quality items,', accent: 'checked sellers.', subtitle: 'Shop products from verified suppliers. Your payment is held until you have your item.', search: true, categoryChips: false },
        { id: id(), type: 'listing_rail', span: full, title: 'Just in', source: 'newest', limit: 8, viewAllHref: '/listings' },
        { id: id(), type: 'resale_categories', span: full, title: 'Shop by category' },
        { id: id(), type: 'listing_grid', span: full, title: 'Everything in store', sort: 'newest', limit: 12 },
        resaleFaq,
        resaleTrust,
      ],
    },
    {
      key: 'shelf',
      name: 'Shelf',
      description: 'Warm and calm: the headline over a shelf of your listings, then categories and the full range.',
      style: { mode: 'light', hero: 'shelf', corners: 'soft', cards: 'outline', font: 'serif', density: 'airy' },
      themes: [
        theme('linen', 'Linen', { primary: '#9a3412', accent: '#0f766e', background: '#fffaf5', surface: '#ffffff', ink: '#2a1206', muted: '#7d6152', heroFrom: '#ffedd5', heroTo: '#fffaf5', heroInk: '#2a1206' }),
        theme('sage', 'Sage', { primary: '#3f6212', accent: '#9d174d', background: '#f8faf3', surface: '#ffffff', ink: '#1a2410', muted: '#606b52', heroFrom: '#ecfccb', heroTo: '#f8faf3', heroInk: '#1a2410' }),
        theme('blush', 'Blush', { primary: '#be185d', accent: '#1e3a8a', background: '#fff7fa', surface: '#ffffff', ink: '#2a0a18', muted: '#7d5c6a', heroFrom: '#fce7f3', heroTo: '#fff7fa', heroInk: '#2a0a18' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Good things,', accent: 'from people we trust.', subtitle: 'Every item comes from a named supplier. Pay safely and only release the money once it is yours.', search: false, categoryChips: false },
        { id: id(), type: 'resale_categories', span: full, title: 'Browse' },
        { id: id(), type: 'listing_grid', span: full, title: 'The collection', sort: 'newest', limit: 12 },
        resaleTrust,
        resaleFaq,
      ],
    },
    {
      key: 'aisle',
      name: 'Aisle',
      description: 'Bold and quick to search: a dark search band with category shortcuts, then deals by price.',
      style: { mode: 'dark', hero: 'aisle', corners: 'sharp', cards: 'flat', font: 'sans', density: 'compact' },
      themes: [
        theme('night_market', 'Night market', { primary: '#f59e0b', accent: '#22c55e', background: '#0b0f17', surface: '#151b26', ink: '#f1f5f9', muted: '#94a3b8', heroFrom: '#0b0f17', heroTo: '#1e293b', heroInk: '#ffffff' }),
        theme('electric', 'Electric', { primary: '#38bdf8', accent: '#f472b6', background: '#070b14', surface: '#111827', ink: '#e5edf8', muted: '#8b9bb0', heroFrom: '#070b14', heroTo: '#172554', heroInk: '#ffffff' }),
        theme('ember', 'Ember', { primary: '#f97316', accent: '#facc15', background: '#0f0a07', surface: '#1c140e', ink: '#fbf3e4', muted: '#a99e88', heroFrom: '#0f0a07', heroTo: '#3b1d0b', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Find it,', accent: 'buy it safely.', subtitle: 'Search everything in store.', search: true, categoryChips: true },
        { id: id(), type: 'listing_rail', span: full, title: 'Lowest prices', source: 'price_low', limit: 8, viewAllHref: '/listings?sort=price_asc' },
        { id: id(), type: 'listing_grid', span: full, title: 'Newest', sort: 'newest', limit: 12 },
        resaleTrust,
      ],
    },
  ],
};
export const storeTemplates: StoreTemplate[] = [allInOne, topups, giftCards, singleProduct, vpnShop, rdpShop, resaleShop];
export const templateKeys = storeTemplates.map(template => template.key) as [TemplateKey, ...TemplateKey[]];

export function templateFor(key: string) {
  return storeTemplates.find(template => template.key === key) ?? null;
}

/** The template's variant (its first when unknown), and the theme (the variant's first when unknown). */
export function designFor(templateKey: string, variantKey?: string | null, themeKey?: string | null) {
  const template = templateFor(templateKey) ?? allInOne;
  const variant = template.variants.find(item => item.key === variantKey) ?? template.variants[0];
  const chosen = variant.themes.find(item => item.key === themeKey) ?? variant.themes[0];
  return { template, variant, theme: chosen };
}

/** The variant's starting home page, validated (defaults filled in) with fresh section ids. */
export function starterHome(templateKey: string, variantKey?: string | null): Sections {
  return sections.parse(designFor(templateKey, variantKey).variant.starter());
}

/** Whether a store's template sells a product: in its categories (all for null), or its focus product for a single product store. */
export function templateSells(store: { template: string; focus: string | null }, product: { key: string; category: ProductCategory }) {
  const template = templateFor(store.template) ?? allInOne;
  // A Resale shop sells suppliers' resale listings, never catalogue products.
  if (template.resale) return false;
  if (template.single) return product.key === store.focus;
  return template.categories === null || template.categories.includes(product.category);
}
