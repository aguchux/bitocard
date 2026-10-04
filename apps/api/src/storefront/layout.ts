import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ProductCategory } from '../generated/prisma/client.js';

/** Every product category, as the storefront names it. */
export const categoryLabels: Record<ProductCategory, string> = {
  gift_cards: 'Gift cards',
  airtime: 'Airtime',
  data: 'Data',
  bills: 'Bills',
  pay_tv: 'Pay-TV',
  esim: 'eSIMs',
  software: 'Software',
  virtual_numbers: 'Virtual numbers',
  virtual_cards: 'Virtual cards',
};

/** The storefront's main menu: each group links to its categories (and lists their top brands). */
export const navigationGroups: Array<{ key: string; label: string; categories: ProductCategory[] }> = [
  { key: 'gift-cards', label: 'Gift cards', categories: ['gift_cards'] },
  { key: 'mobile', label: 'Mobile', categories: ['airtime', 'data', 'virtual_numbers'] },
  { key: 'bills', label: 'Bills', categories: ['bills', 'pay_tv'] },
  { key: 'esims', label: 'eSIMs', categories: ['esim'] },
  { key: 'software', label: 'Software', categories: ['software'] },
  { key: 'virtual-cards', label: 'Virtual cards', categories: ['virtual_cards'] },
];

/** Words people search with that mean a category. */
export const categorySynonyms: Record<ProductCategory, string[]> = {
  gift_cards: ['gift card', 'gift cards', 'voucher', 'giftcard'],
  airtime: ['airtime', 'top up', 'top-up', 'topup', 'recharge', 'credit', 'mobile'],
  data: ['data', 'bundle', 'internet', 'mobile data'],
  bills: ['bills', 'bill', 'electricity', 'power', 'water', 'utility', 'utilities', 'meter'],
  pay_tv: ['tv', 'pay-tv', 'pay tv', 'cable', 'subscription', 'satellite'],
  esim: ['esim', 'e-sim', 'travel data', 'roaming', 'travel'],
  software: ['software', 'licence', 'license', 'antivirus', 'windows', 'office', 'key'],
  virtual_numbers: ['virtual number', 'phone number', 'number', 'sms', 'did'],
  virtual_cards: ['virtual card', 'card', 'debit card', 'dollar card'],
};

const categories = Object.keys(categoryLabels) as [ProductCategory, ...ProductCategory[]];

/** A link: a path on the storefront, or an HTTPS address. */
const href = z
  .string()
  .trim()
  .max(500)
  .refine(value => value.startsWith('/') ? !value.startsWith('//') : /^https:\/\/[^\s]+$/.test(value), 'Use a path such as /catalogs/esim or an https:// address.');
const imageUrl = z.string().trim().max(1000).regex(/^https:\/\/[^\s]+$/, 'Use an https:// image address.');
const text = (max: number) => z.string().trim().max(max);

/**
 * Where a section sits on the grid: desktop has 12 columns, tablet 6, phones 1 (every section full width, in order).
 * `rows: 2` lets a tall section (a product rail) sit beside two stacked short ones (promos), as the grid packs densely.
 */
const span = z.object({
  lg: z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(9), z.literal(12)]),
  md: z.union([z.literal(3), z.literal(6)]),
  rows: z.union([z.literal(1), z.literal(2)]).default(1),
});

const base = {
  id: z.string().trim().min(1).max(60),
  span,
  /** Kept in the layout but not shown. */
  hidden: z.boolean().default(false),
};

export const productSources = ['trending', 'top_selling', 'new', 'featured', 'category', 'brand', 'manual'] as const;

const hero = z.object({
  ...base,
  type: z.literal('hero'),
  title: text(80).min(1),
  accent: text(80).default(''),
  subtitle: text(240).default(''),
  /** The search box with its country picker. */
  search: z.boolean().default(true),
  /** Shortcut chips for each category group. */
  categoryChips: z.boolean().default(true),
});

const productRail = z
  .object({
    ...base,
    type: z.literal('product_rail'),
    title: text(80).min(1),
    subtitle: text(200).default(''),
    /** Trending: most sold in 7 days; top selling: 30 days; new: newest; featured: featured brands; or by category, brand or hand-picked products. */
    source: z.enum(productSources),
    category: z.enum(categories).optional(),
    brand: text(80).optional(),
    /** Hand-picked products (product keys), in this order. */
    productKeys: z.array(text(200)).max(24).default([]),
    limit: z.number().int().min(1).max(24).default(6),
    /** Filter chips (All, the visitor's country, Global and brand tags). */
    filters: z.boolean().default(false),
    layout: z.enum(['cards', 'list']).default('cards'),
    viewAllHref: href.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'category' && !value.category) ctx.addIssue({ code: 'custom', message: 'Choose a category.', path: ['category'] });
    if (value.source === 'brand' && !value.brand) ctx.addIssue({ code: 'custom', message: 'Choose a brand.', path: ['brand'] });
    if (value.source === 'manual' && value.productKeys.length === 0) ctx.addIssue({ code: 'custom', message: 'Pick at least one product.', path: ['productKeys'] });
  });

const categoryGrid = z.object({
  ...base,
  type: z.literal('category_grid'),
  title: text(80).min(1),
  subtitle: text(200).default(''),
  /** Which categories, in order; empty means every category on sale. */
  categories: z.array(z.enum(categories)).max(9).default([]),
});

const brandGrid = z.object({
  ...base,
  type: z.literal('brand_grid'),
  title: text(80).min(1),
  subtitle: text(200).default(''),
  /** Only brands with this tag (for example gaming); empty means featured brands first. */
  tag: text(40).default(''),
  limit: z.number().int().min(1).max(24).default(12),
});

const promo = z.object({
  ...base,
  type: z.literal('promo'),
  title: text(80).min(1),
  subtitle: text(120).default(''),
  body: text(300).default(''),
  bullets: z.array(text(80).min(1)).max(5).default([]),
  cta: z.object({ label: text(40).min(1), href }).optional(),
  imageUrl: imageUrl.optional(),
  /** The card's colours. */
  theme: z.enum(['pink', 'sky', 'navy', 'light', 'sunset']).default('pink'),
  /** A drawn illustration when there is no image. */
  illustration: z.enum(['store', 'esim', 'gift', 'globe', 'none']).default('none'),
});

const trustBar = z.object({
  ...base,
  type: z.literal('trust_bar'),
  items: z
    .array(z.object({ icon: z.enum(['lock', 'bolt', 'card', 'globe', 'shield', 'support']), title: text(60).min(1), body: text(120).default('') }))
    .min(1)
    .max(4),
});

export const section = z.discriminatedUnion('type', [hero, productRail, categoryGrid, brandGrid, promo, trustBar]);
export const sections = z
  .array(section)
  .max(40)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: 'Each section needs its own id.', path: [index, 'id'] });
      seen.add(item.id);
    });
  });

export type Section = z.infer<typeof section>;
export type Sections = z.infer<typeof sections>;
export type SectionType = Section['type'];

const id = () => randomUUID().slice(0, 8);

/**
 * The first home page, laid out like the approved design: hero, trending beside two promos, then everything else
 * the store sells. Admins rearrange it in the Storefront Manager; it stays a draft until published.
 */
export function defaultHome(shqSignupUrl = '/resellers'): Sections {
  return sections.parse([
    { id: id(), type: 'hero', span: { lg: 12, md: 6 }, title: 'One marketplace.', accent: 'More ways to pay.', subtitle: 'Shop gift cards, top up mobile, pay bills, and explore digital essentials.' },
    {
      id: id(),
      type: 'product_rail',
      span: { lg: 8, md: 6, rows: 2 },
      title: 'Trending now',
      subtitle: 'Popular brands. Great selection. Delivered digitally.',
      source: 'trending',
      limit: 6,
      filters: true,
      viewAllHref: '/catalogs',
    },
    {
      id: id(),
      type: 'promo',
      span: { lg: 4, md: 3 },
      title: 'Reseller spotlight',
      subtitle: 'Create your own digital store and sell top brands.',
      bullets: ['Wide product selection', 'Flexible pricing', 'Your brand, your customers'],
      cta: { label: 'Start selling', href: shqSignupUrl },
      theme: 'pink',
      illustration: 'store',
    },
    {
      id: id(),
      type: 'promo',
      span: { lg: 4, md: 3 },
      title: 'Stay connected anywhere',
      subtitle: 'eSIM travel data',
      body: 'Data for your next trip, ready before you land.',
      cta: { label: 'Browse eSIMs', href: '/catalogs/esim' },
      theme: 'sky',
      illustration: 'esim',
    },
    { id: id(), type: 'category_grid', span: { lg: 12, md: 6 }, title: 'Shop by category', subtitle: 'Everything digital, in one place.' },
    { id: id(), type: 'product_rail', span: { lg: 12, md: 6 }, title: 'Top selling', subtitle: 'What customers buy most this month.', source: 'top_selling', limit: 8, viewAllHref: '/catalogs' },
    { id: id(), type: 'product_rail', span: { lg: 6, md: 6 }, title: 'Top up mobile', subtitle: 'Airtime and data, delivered in seconds.', source: 'category', category: 'airtime', limit: 4, layout: 'list', viewAllHref: '/catalogs/airtime' },
    { id: id(), type: 'product_rail', span: { lg: 6, md: 6 }, title: 'Pay bills and TV', subtitle: 'Electricity, water and TV subscriptions.', source: 'category', category: 'pay_tv', limit: 4, layout: 'list', viewAllHref: '/catalogs/pay_tv' },
    { id: id(), type: 'brand_grid', span: { lg: 12, md: 6 }, title: 'Popular brands', subtitle: 'Find the brands you love.', limit: 12 },
    { id: id(), type: 'product_rail', span: { lg: 12, md: 6 }, title: 'New in store', subtitle: 'The latest additions to the catalogue.', source: 'new', limit: 8, viewAllHref: '/catalogs' },
    {
      id: id(),
      type: 'trust_bar',
      span: { lg: 12, md: 6 },
      items: [
        { icon: 'lock', title: 'Secure checkout', body: 'Your information is protected.' },
        { icon: 'bolt', title: 'Digital delivery', body: 'Most products arrive in minutes.' },
        { icon: 'card', title: 'Local payment options', body: 'Pay the way that suits you.' },
        { icon: 'support', title: 'Help when you need it', body: 'Our support team is here for you.' },
      ],
    },
  ]);
}
