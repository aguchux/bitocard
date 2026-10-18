import { randomUUID } from 'node:crypto';
import type { ProductCategory } from '../generated/prisma/client.js';
import { type SectionType, type Sections, sections } from '../storefront/layout.js';

/**
 * Reseller store templates. A template decides what a store sells (its categories, or one product, or the crypto
 * desk) and which sections its editor offers; each has design variants with their own look (light or dark, the hero,
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
  hero: 'search' | 'gradient' | 'minimal' | 'quick_buy' | 'networks' | 'billers' | 'card_wall' | 'boutique' | 'neon' | 'terminal' | 'market' | 'swap' | 'spotlight' | 'split' | 'story';
  corners: 'sharp' | 'soft' | 'round';
  cards: 'flat' | 'raised' | 'outline' | 'glass';
  font: 'sans' | 'display' | 'mono' | 'serif';
  /** Section spacing. */
  density: 'compact' | 'comfortable' | 'airy';
};

export type TemplateVariant = { key: string; name: string; description: string; style: VariantStyle; themes: StoreTheme[]; starter: () => unknown[] };

export type TemplateKey = 'all_in_one' | 'topups' | 'gift_cards' | 'crypto_desk' | 'single_product';

export type StoreTemplate = {
  key: TemplateKey;
  name: string;
  tagline: string;
  description: string;
  /** What the store sells: these categories, every category (null), or nothing from the catalogue (the crypto desk). */
  categories: ProductCategory[] | null;
  /** The store sells one product, chosen as its `focus`. */
  single: boolean;
  /** The store is the crypto desk: offered only where the reseller's exchange or P2P is switched on. */
  crypto: boolean;
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
  crypto: false,
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
  crypto: false,
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
  crypto: false,
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

// -- 4. Crypto desk ---------------------------------------------------------------------------------------------------

const cryptoFaq = {
  id: id(),
  type: 'faq',
  span: full,
  title: 'Questions',
  items: [
    { question: 'How is the price set?', answer: 'From the coin’s live market price. The quote shows exactly what you get and holds for 30 seconds.' },
    { question: 'What is P2P?', answer: 'Buying and selling with other traders at the prices they set, paid instantly from your wallet.' },
    { question: 'Can I withdraw my coins?', answer: 'Yes, to your own wallet address, once it has been saved for 24 hours.' },
  ],
};

const cryptoDesk: StoreTemplate = {
  key: 'crypto_desk',
  name: 'Crypto desk',
  tagline: 'Buy and sell crypto instantly, or trade P2P.',
  description: 'An exchange store: an instant buy and sell quote, the P2P market and coin wallets. Offered where crypto is switched on for you.',
  categories: [],
  single: false,
  crypto: true,
  sections: ['hero', 'crypto_quote', 'p2p_market', 'promo', 'trust_bar', 'features', 'faq'],
  variants: [
    {
      key: 'terminal',
      name: 'Trading terminal',
      description: 'Dark and dense: the quote form beside the P2P book, like a trading screen.',
      style: { mode: 'dark', hero: 'terminal', corners: 'sharp', cards: 'flat', font: 'mono', density: 'compact' },
      themes: [
        theme('matrix', 'Matrix', { primary: '#22c55e', accent: '#ef4444', background: '#05070a', surface: '#0d1117', ink: '#e6edf3', muted: '#8b949e', heroFrom: '#05070a', heroTo: '#0d1117', heroInk: '#e6edf3' }),
        theme('gold_rush', 'Gold rush', { primary: '#eab308', accent: '#f97316', background: '#0a0804', surface: '#16120a', ink: '#fbf5e6', muted: '#a89f87', heroFrom: '#0a0804', heroTo: '#2a1f06', heroInk: '#ffffff' }),
        theme('ice', 'Ice', { primary: '#38bdf8', accent: '#a78bfa', background: '#050a12', surface: '#0c1524', ink: '#e8f3ff', muted: '#8ea2bd', heroFrom: '#050a12', heroTo: '#0c2340', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'crypto_quote', span: { lg: 6, md: 6 }, title: 'Instant buy and sell', subtitle: 'Live price, held for 30 seconds.' },
        { id: id(), type: 'p2p_market', span: { lg: 6, md: 6 }, title: 'P2P market', subtitle: 'Best offers from traders.', asset: 'USDT' },
        trust([
          ['chart', 'Live prices', 'From the coin’s market price.'],
          ['bolt', 'Instant', 'Settled to your wallet at once.'],
          ['shield', 'Screened', 'Withdrawal addresses are checked.'],
          ['lock', 'Your keys stay safe', 'Withdrawals need your code.'],
        ]),
        cryptoFaq,
      ],
    },
    {
      key: 'market',
      name: 'P2P market',
      description: 'The P2P market leads: offers for each coin, with the instant desk below.',
      style: { mode: 'light', hero: 'market', corners: 'soft', cards: 'outline', font: 'sans', density: 'comfortable' },
      themes: [
        theme('trust_blue', 'Trust blue', { primary: '#1d4ed8', accent: '#16a34a', background: '#f6f8fd', surface: '#ffffff', ink: '#0c1733', muted: '#56627f', heroFrom: '#1d4ed8', heroTo: '#1e3a8a', heroInk: '#ffffff' }),
        theme('binance_gold', 'Gold', { primary: '#b45309', accent: '#16a34a', background: '#fffbf2', surface: '#ffffff', ink: '#271a03', muted: '#7a6a4a', heroFrom: '#f59e0b', heroTo: '#b45309', heroInk: '#ffffff' }),
        theme('slate', 'Slate', { primary: '#0f172a', accent: '#22c55e', background: '#f8fafc', surface: '#ffffff', ink: '#0f172a', muted: '#64748b', heroFrom: '#0f172a', heroTo: '#334155', heroInk: '#ffffff' }),
      ],
      starter: () => [
        { id: id(), type: 'hero', span: full, title: 'Trade crypto', accent: 'with people you can trust.', subtitle: 'Buy and sell USDT, BTC and more at traders’ prices, paid instantly.', search: false, categoryChips: false },
        { id: id(), type: 'p2p_market', span: half, title: 'Buy USDT', asset: 'USDT' },
        { id: id(), type: 'p2p_market', span: half, title: 'Buy BTC', asset: 'BTC' },
        { id: id(), type: 'crypto_quote', span: full, title: 'Prefer an instant price?', subtitle: 'Buy or sell straight from the desk.' },
        cryptoFaq,
      ],
    },
    {
      key: 'swap',
      name: 'Simple swap',
      description: 'One calm swap form in the middle of the page: the easiest way to buy a first coin.',
      style: { mode: 'light', hero: 'swap', corners: 'round', cards: 'raised', font: 'display', density: 'airy' },
      themes: [
        theme('aurora', 'Aurora', { primary: '#7c3aed', accent: '#06b6d4', background: '#faf8ff', surface: '#ffffff', ink: '#1a1033', muted: '#625a7d', heroFrom: '#ede9fe', heroTo: '#cffafe', heroInk: '#1a1033' }),
        theme('peach', 'Peach', { primary: '#c2410c', accent: '#db2777', background: '#fff8f4', surface: '#ffffff', ink: '#2a1206', muted: '#7d6152', heroFrom: '#ffedd5', heroTo: '#fce7f3', heroInk: '#2a1206' }),
        theme('seafoam', 'Seafoam', { primary: '#0d9488', accent: '#2563eb', background: '#f5fdfb', surface: '#ffffff', ink: '#062421', muted: '#4f6e6a', heroFrom: '#ccfbf1', heroTo: '#dbeafe', heroInk: '#062421' }),
      ],
      starter: () => [
        { id: id(), type: 'crypto_quote', span: full, title: 'Your first coin in a minute', subtitle: 'Choose a coin and an amount. You see exactly what you get.', assets: ['USDT', 'BTC', 'ETH'] },
        {
          id: id(),
          type: 'features',
          span: full,
          title: 'Simple and safe',
          items: [
            { icon: 'coin', title: 'Choose a coin', body: 'USDT, BTC, ETH and more.' },
            { icon: 'chart', title: 'See the price', body: 'Held for 30 seconds while you decide.' },
            { icon: 'bolt', title: 'It’s yours', body: 'In your wallet at once.' },
          ],
        },
        cryptoFaq,
      ],
    },
  ],
};

// -- 5. Single product ------------------------------------------------------------------------------------------------

const singleProduct: StoreTemplate = {
  key: 'single_product',
  name: 'Single product',
  tagline: 'One product, one page, one buy button.',
  description: 'A landing page for one product or brand: an eSIM plan, a virtual number, one gift card brand or a bundle. The buy form sits above the fold.',
  categories: null,
  single: true,
  crypto: false,
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

export const storeTemplates: StoreTemplate[] = [allInOne, topups, giftCards, cryptoDesk, singleProduct];
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
  if (template.single) return product.key === store.focus;
  return template.categories === null || template.categories.includes(product.category);
}
