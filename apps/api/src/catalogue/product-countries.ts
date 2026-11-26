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

export function giftCardProductCountries(rows: readonly { country: string; giftCardCountries: string[]; giftCardRedemptionScope: string | null }[]) {
  const codes = new Set<string>();
  for (const row of rows) {
    for (const country of row.giftCardCountries) codes.add(country);
    if (row.giftCardCountries.length === 0) codes.add(row.giftCardRedemptionScope === 'global' ? 'WW' : row.country);
  }
  return productCountries([...codes].map(country => ({ country })));
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
  return country ? [{ category: 'gift_cards', OR: [{ country }, { giftCardCountries: { has: country } }] }] : [];
}
