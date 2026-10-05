import { z } from 'zod';
import type { AppConfig } from '../config/config.js';
import data from './brand-registry.json' with { type: 'json' };

/**
 * The brand registry (`brand-registry.json`): default name, company, colour, initials, search words, tags, logo and
 * card art for well-known brands (MTN, Airtel, Amazon, Google Play…), so stores look branded before an admin sets a
 * brand up. An admin's settings (the `brands` table) always win field by field. One entry can cover several product
 * brand slugs (PlayStation: `playstation`, `psn-plus`).
 *
 * Asset locations are an https:// address, or a storage path (`brands/mtn/logo.svg`) served from file storage under
 * `<SPACES_ROOT>/platform/`; `npm run brands:logos -w @bitocard/api` uploads a folder of logos to those paths.
 *
 * `icon` names the entry's mark in the bundled icon pack (`assets/BitoCard-Brand-Icons-500x500`); `node
 * scripts/brand-icons.mjs` copies it to the store as `/brand-icons/<slug>.svg`, the logo used when there is no upload
 * and no `logo`. `art` names the entry's gift card design in the bundled card art pack (`assets/BitoCard-Gift-Card-Art`);
 * `node scripts/brand-cards.mjs` writes it to the store as `/brand-cards/<slug>.webp`, the card art used when there is no
 * upload and no `card`.
 */
const location = z
  .string()
  .trim()
  .refine(value => /^https:\/\/\S+$/.test(value) || /^[a-z0-9][a-z0-9._/-]*\.(svg|png|webp|jpg|jpeg)$/i.test(value), 'an https:// address or a storage path such as brands/mtn/logo.svg')
  .refine(value => !value.includes('..'), 'no .. in paths')
  .nullable();

const entry = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(80),
  company: z.string().max(120).nullable().optional(),
  slugs: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  initials: z.string().min(1).max(4).optional(),
  aliases: z.array(z.string().min(1).max(60)).default([]),
  tags: z.array(z.string().min(1).max(40)).default([]),
  logo: location,
  card: location,
  icon: z
    .string()
    .regex(/^[a-z0-9-]+\/[a-z0-9-]+\.svg$/)
    .optional(),
  art: z
    .string()
    .regex(/^[a-z0-9-]+\.png$/)
    .optional(),
});

export type RegistryBrand = z.infer<typeof entry>;

export const brandRegistry: RegistryBrand[] = z
  .object({ about: z.string(), brands: z.array(entry) })
  .parse(data)
  .brands;

const bySlug = new Map<string, RegistryBrand>();
for (const brand of brandRegistry) {
  for (const slug of new Set([brand.slug, ...brand.slugs])) {
    if (bySlug.has(slug)) throw new Error(`Brand registry: ${slug} is listed twice.`);
    bySlug.set(slug, brand);
  }
}

/** The registry entry covering a product brand slug, if any. */
export const registryBrand = (slug: string) => bySlug.get(slug) ?? null;

/** Up to three letters for a brand without a logo: its registry initials, else the first letters of its words. */
export function brandInitials(name: string, override?: string) {
  if (override) return override;
  const words = name
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

/** The entry's bundled icon on the store (`/brand-icons/<slug>.svg`), if it has one. */
export function registryIconUrl(brand: RegistryBrand | null, config: Pick<AppConfig, 'STOREFRONT_URL'>) {
  if (!brand?.icon) return null;
  return `${config.STOREFRONT_URL.replace(/\/+$/, '')}/brand-icons/${brand.slug}.svg`;
}

/** The entry's bundled card art on the store (`/brand-cards/<slug>.webp`), if it has one. */
export function registryCardArtUrl(brand: RegistryBrand | null, config: Pick<AppConfig, 'STOREFRONT_URL'>) {
  if (!brand?.art) return null;
  return `${config.STOREFRONT_URL.replace(/\/+$/, '')}/brand-cards/${brand.slug}.webp`;
}

/**
 * A registry asset as a public address: https:// addresses as they are; storage paths under the platform folder of
 * the file storage's public address, or nothing while file storage is not set up.
 */
export function registryAssetUrl(value: string | null, config: Pick<AppConfig, 'SPACES_BUCKET' | 'SPACES_REGION' | 'SPACES_PUBLIC_URL' | 'SPACES_ROOT'>) {
  if (!value) return null;
  if (value.startsWith('https://')) return value;
  if (!config.SPACES_PUBLIC_URL && !config.SPACES_BUCKET) return null;
  const base = (config.SPACES_PUBLIC_URL ?? `https://${config.SPACES_BUCKET}.${config.SPACES_REGION}.digitaloceanspaces.com`).replace(/\/+$/, '');
  return `${base}/${config.SPACES_ROOT}/platform/${value.replace(/^\/+/, '')}`;
}

/** Product brand slugs whose registry name, company or search words match a query (for store search). */
export function registrySlugsMatching(phrase: string, words: string[]) {
  const slugs: string[] = [];
  for (const brand of brandRegistry) {
    const text = [brand.name, brand.company ?? ''].join(' ').toLowerCase();
    if (text.includes(phrase) || brand.aliases.some(alias => alias.toLowerCase() === phrase || words.includes(alias.toLowerCase()))) slugs.push(...new Set([brand.slug, ...brand.slugs]));
  }
  return slugs;
}
