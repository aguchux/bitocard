import { getCountries } from 'libphonenumber-js';
import type { Prisma } from '../generated/prisma/client.js';

const regions = new Intl.DisplayNames(['en-GB'], { type: 'region', fallback: 'none' });

export function productCountryName(code: string) {
  return code === 'WW' ? 'Worldwide' : /^[A-Z]{2}$/.test(code) ? (regions.of(code) ?? code) : code;
}

export function productCountries(rows: readonly { country: string }[]) {
  return rows.map(({ country: code }) => ({ code, name: productCountryName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const giftCardRegions = new Map(productCountries([...getCountries(), 'WW'].map(country => ({ country })))
  .map(({ code, name }) => [name.toLowerCase(), code]));
giftCardRegions.set('united states of america', 'US');
giftCardRegions.set('usa', 'US');
giftCardRegions.set('uk', 'GB');

/** A country name or code also finds cards whose country never appears in their title. */
export function giftCardCountrySearch(query: string): Prisma.ProductWhereInput[] {
  const term = query.trim().toLowerCase();
  const country = giftCardRegions.get(term) ?? (/^[a-z]{2}$/.test(term) ? term.toUpperCase() : null);
  return country ? [{ category: 'gift_cards', country }] : [];
}
