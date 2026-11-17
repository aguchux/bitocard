import { bitocardApi } from '../base';
import type { Mode } from './common';

/** One gift card a customer of your store sold (`/v1/gift-card-sales/buy-back`). Amounts in minor units of `currency`. */
export type BuyBackSale = {
  object: 'gift_card_sale';
  id: string;
  /** GS-000123. */
  number: string;
  mode: Mode;
  status: 'pending' | 'completed' | 'rejected' | 'failed';
  card: { name: string; brand: string | null; brand_slug: string | null; country: string | null };
  form: 'physical' | 'ecode';
  /** The card's value in its own units (100 for a $100 card). */
  amount: number;
  currency: string;
  /** What the customer was told they would get, and what they got once the card was accepted. */
  quoted: number;
  paid: number | null;
  reason: string | null;
  customer: { id: string; name: string; email: string };
  /** Your cut of BitoCard's rate when the card was sent, and what it came to once accepted (in your earnings, after the payout hold). */
  spread_bps: number;
  earned: number | null;
  created_at: string;
  decided_at: string | null;
};

/**
 * Buy back on your stores: whether it is open for you (`reason`: `not_enabled`, `country_unsupported`,
 * `not_configured`), your cut (your gift card markup, else your general markup, up to `cap_bps`) and the latest 100 sales.
 */
export type BuyBack = { object: 'gift_card_buy_back'; mode: Mode; available: boolean; reason: string | null; currency: string | null; spread_bps: number; cap_bps: number; data: BuyBackSale[] };

export const resellerBuyBackApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    giftCardBuyBack: build.query<BuyBack, void>({ query: () => '/v1/gift-card-sales/buy-back', providesTags: ['Pricing'] }),
  }),
});

export const { useGiftCardBuyBackQuery } = resellerBuyBackApi;
