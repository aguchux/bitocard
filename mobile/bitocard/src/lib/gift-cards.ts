/**
 * Gift cards, buying and selling: which values a card is offered at and what each costs at the day's rate, what a sale
 * says, and what a sell offer takes. Free of React Native, so it runs under `node --test`.
 */
import { digitsOf } from './money.ts';
import type { GiftCardSale, SellOffer, StoreProductDetail, StoreRate } from './types.ts';

/** The values to choose from, in minor units of the card's currency: the fixed ones, else round amounts in its range. */
export function valuesOf(detail: Pick<StoreProductDetail, 'denominations' | 'range' | 'face_currency'>, rate?: StoreRate | null) {
  if (detail.denominations?.length) return [...detail.denominations].sort((a, b) => a - b);
  if (rate && rate.rate !== null && rate.values.length) return rate.values.map(value => value.face_value).sort((a, b) => a - b);
  if (!detail.range) return [];
  const unit = 10 ** digitsOf(detail.face_currency);
  return [10, 25, 50, 100, 200, 500].map(whole => whole * unit).filter(value => value >= detail.range!.min && value <= detail.range!.max);
}

/**
 * What one card of `face` costs the customer at the rate (minor units of `rate.currency`): the API's own price where
 * it priced that value, else the rate times the value, rounded up so the screen never shows less than checkout asks.
 */
export function priceAt(rate: StoreRate | null | undefined, face: number, faceCurrency: string) {
  if (!rate || rate.rate === null) return null;
  const listed = rate.values.find(value => value.face_value === face);
  if (listed) return listed.price;
  return Math.ceil((face / 10 ** digitsOf(faceCurrency)) * rate.rate);
}

/** What the customer gets for a card of `amount` whole units at the offer's rate (the quote is the API's exact figure). */
export const payoutAt = (offer: Pick<SellOffer, 'rate'>, amount: number) => Math.floor(offer.rate * amount);

/** How a card is sent: photos of a physical card, its code for an e-code, either where the buyer takes both. */
export const sellForms = (offer: Pick<SellOffer, 'form'>): ('physical' | 'ecode')[] => (offer.form === 'physical' ? ['physical'] : offer.form === 'ecode' ? ['ecode'] : ['physical', 'ecode']);

/** A typed card value in whole units, within the offer's limits; else why not. */
export function saleAmount(text: string, offer: Pick<SellOffer, 'minimum' | 'maximum' | 'currency'>): { amount: number } | { problem: string } {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return { problem: 'Enter the card’s value in whole units, as printed on it.' };
  const amount = Number(cleaned);
  if (amount < offer.minimum || amount > offer.maximum) return { problem: `This card is bought from ${offer.minimum} to ${offer.maximum}.` };
  return { amount };
}

const saleWords: Record<GiftCardSale['status'], { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  pending: { label: 'Being checked', tone: 'warn' },
  completed: { label: 'Accepted and paid', tone: 'good' },
  rejected: { label: 'Declined', tone: 'bad' },
  failed: { label: 'Could not be sent', tone: 'bad' },
};

export const saleStatusOf = (status: GiftCardSale['status']) => saleWords[status] ?? { label: status, tone: 'warn' as const };
