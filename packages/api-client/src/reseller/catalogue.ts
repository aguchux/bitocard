import { bitocardApi } from '../base';
import { type List, type Mode, type Page, params } from './common';

/** Product categories, in the order the catalogue shows them. */
export const catalogueCategories = ['gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards'] as const;
export type CatalogueCategory = (typeof catalogueCategories)[number];

/** What the customer must give when buying: a phone number, a smartcard or IUC number, a meter number, or nothing. */
export type RecipientType = 'phone' | 'smartcard' | 'meter' | 'none';

export type Denomination = { type: 'fixed'; values: number[] } | { type: 'range'; min: number; max: number };

/** One priced face value: what BitoCard charges you and what your customer pays (before any tax added at checkout). */
export type PricedDenomination = { face_value: number; wholesale: number; price: number };

/** A product as one reseller sees it (`/v1/catalogue/products`). Face values are in `face_currency`; prices in `pricing.currency`. */
export type Product = {
  object: 'product';
  id: string;
  category: CatalogueCategory;
  country: string;
  brand: string;
  name: string;
  face_currency: string;
  denomination: Denomination;
  recipient_type: RecipientType;
  description: string | null;
  redeem_instructions: string | null;
  /** What it can do, for example `sms_in` or `app_codes` on a virtual number. */
  features: string[];
  logo_url: string | null;
  /** Fixed values (up to 20), or the lowest and highest of a range. A quote locks the exact price. */
  pricing: { currency: string; denominations: PricedDenomination[] };
};

/** The catalogue pages on `next_cursor`: products that cannot be priced are left out, so the last item is not always the cursor. */
export type ProductList = List<Product> & { next_cursor: string | null };
export type ProductFilter = { category?: CatalogueCategory; country?: string; q?: string; limit?: number };

export type QuoteStatus = 'open' | 'used' | 'expired';
/** The recipient as checked: phone for airtime and data; account number, account name and details (such as the current package) for pay-TV and bills. */
export type QuoteRecipient = { phone?: string; account_number?: string; account_name?: string; transaction_type?: 'change' | 'renew'; [detail: string]: string | undefined };
export type TaxLine = { name: string; rate_percent: number; amount: number };

/** A price locked for 10 minutes (`/v1/quotes`). Amounts are in `currency` for the whole quantity. */
export type Quote = {
  object: 'quote';
  id: string;
  mode: Mode;
  status: QuoteStatus;
  product: { id: string; name: string; category: CatalogueCategory };
  face_value: number;
  face_currency: string;
  quantity: number;
  currency: string;
  /** What BitoCard takes from your wallet. */
  wholesale: number;
  unit_wholesale: number;
  /** What the customer pays, tax included. */
  price: number;
  tax: TaxLine | null;
  reseller_profit: number;
  /** `own`: fulfilled through your own supplier account; BitoCard charges only its fee. */
  source: 'bitocard' | 'own';
  integration: { id: string; name: string } | null;
  /** Own supplier: BitoCard's fee, at most `max` (fractions are carried, never rounded up). */
  bitocard_fee: { rate_percent: string; max: number } | null;
  recipient: QuoteRecipient | null;
  customer_reference: string | null;
  expires_at: string;
  created_at: string;
};

export type CreateQuote = {
  product_id: string;
  face_value: number;
  quantity?: number;
  recipient?: { phone?: string; account_number?: string; transaction_type?: 'change' | 'renew' };
  customer_reference?: string;
};

/** A markup over wholesale price, for a whole category (`product_id` null) or one product, in basis points (1500 = 15%). */
/** `product_name` is set for a product markup (null if the product no longer exists). */
export type Markup = { category: CatalogueCategory; product_id: string | null; product_name: string | null; markup_bps: number };

/**
 * How you earn (`/v1/pricing`): `markup` adds your markup to face-value products; `discount` sells them at face value and
 * you earn BitoCard's discount. Markups are capped by the Markup Protection Scheme (`markup_cap_percent`).
 */
export type Pricing = { object: 'pricing'; currency: string; earning: 'markup' | 'discount'; markup_cap_percent: number; markups: Markup[] };

/** The catalogue, quotes and your markups. Quotes and products follow live or sandbox mode; pricing settings are the same in both. */
export const resellerCatalogueApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    catalogueProducts: build.infiniteQuery<ProductList, ProductFilter, string>({
      infiniteQueryOptions: {
        initialPageParam: '',
        getNextPageParam: last => (last.has_more && last.next_cursor ? last.next_cursor : undefined),
      },
      query: ({ queryArg, pageParam }) => ({ url: '/v1/catalogue/products', params: params({ limit: 25, ...queryArg, starting_after: pageParam } satisfies ProductFilter & Page) }),
      providesTags: [{ type: 'Catalogue', id: 'LIST' }],
    }),
    catalogueProduct: build.query<Product, string>({
      query: id => `/v1/catalogue/products/${id}`,
      providesTags: (_result, _error, id) => [{ type: 'Catalogue', id }],
    }),
    createQuote: build.mutation<Quote, CreateQuote>({ query: body => ({ url: '/v1/quotes', method: 'POST', body }) }),
    quote: build.query<Quote, string>({ query: id => `/v1/quotes/${id}` }),

    resellerPricing: build.query<Pricing, void>({ query: () => '/v1/pricing', providesTags: ['Pricing'] }),
    setMarkup: build.mutation<Pricing, { category: CatalogueCategory; product_id?: string; markup_bps: number }>({
      query: body => ({ url: '/v1/pricing/markups', method: 'PUT', body }),
      invalidatesTags: ['Pricing', 'Catalogue'],
    }),
    removeMarkup: build.mutation<Pricing, { category: CatalogueCategory; product_id?: string }>({
      query: args => ({ url: '/v1/pricing/markups', method: 'DELETE', params: params(args) }),
      invalidatesTags: ['Pricing', 'Catalogue'],
    }),
  }),
});

export const {
  useCatalogueProductsInfiniteQuery,
  useCatalogueProductQuery,
  useCreateQuoteMutation,
  useQuoteQuery,
  useResellerPricingQuery,
  useSetMarkupMutation,
  useRemoveMarkupMutation,
} = resellerCatalogueApi;
