import { bitocardApi } from '../base';
import { settleOptimistic } from '../optimistic';
import { type List, type Mode, type Page, params } from './common';

/** Product categories, in the order the catalogue shows them. */
export const catalogueCategories = ['gift_cards', 'airtime', 'data', 'bills', 'pay_tv', 'esim', 'software', 'virtual_numbers', 'virtual_cards', 'mobile_money'] as const;
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
  /** A picture for the product: its own image, else its brand's gift card design. */
  image_url: string | null;
  /** Listed on your BitoCard-hosted store. Your own systems can sell any product, listed or not. */
  listed: boolean;
  /** Fixed values (up to 20), or the lowest and highest of a range. A quote locks the exact price. */
  pricing: { currency: string; denominations: PricedDenomination[] };
};

/** The catalogue pages on `next_cursor`: products that cannot be priced are left out, so the last item is not always the cursor. */
export type ProductList = List<Product> & { next_cursor: string | null };
export type ProductFilter = { category?: CatalogueCategory; country?: string; q?: string; listed?: boolean; limit?: number };

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
  /** `email`: gift cards and software, the customer the codes or keys are emailed to once delivered. */
  recipient?: { phone?: string; account_number?: string; transaction_type?: 'change' | 'renew'; email?: string };
  customer_reference?: string;
};

/**
 * One of your pricing settings: general (`category` and `product_id` null), per category, or per product. On markup
 * products: `markup_bps` over BitoCard's price, or (per product) `fixed_price`. On discount products:
 * `customer_discount_bps`, the part of face value you give your customers. Null fields fall back to the next level up.
 */
export type Markup = {
  category: CatalogueCategory | null;
  product_id: string | null;
  product_name: string | null;
  markup_bps: number | null;
  customer_discount_bps: number | null;
  fixed_price: number | null;
};

/** Your pricing (`/v1/pricing`): your settings and the Markup Protection Scheme cap on markups. */
export type Pricing = { object: 'pricing'; currency: string; markup_cap_percent: number; markups: Markup[] };

export type MarkupInput = {
  category?: CatalogueCategory | null;
  product_id?: string | null;
  markup_bps?: number | null;
  customer_discount_bps?: number | null;
  fixed_price?: number | null;
};

/** One sale of a product as you would make it (`/v1/catalogue/products/{id}/price-preview`). Amounts in minor units of `currency`. */
export type PricePreview = {
  object: 'price_preview';
  product_id: string;
  mode: Mode;
  currency: string;
  face_value: number;
  scheme: 'discount' | 'markup';
  face_price: number | null;
  bitocard_price: number;
  your_discount: number | null;
  customer_discount: number | null;
  customer_price: number;
  your_profit: number;
  markup_cap_bps: number;
  fixed_below_cost: boolean;
  settings: {
    customer_discount_bps: number;
    markup_bps: number;
    fixed_price: number | null;
    from: { customer_discount: 'product' | 'category' | 'general' | 'none'; markup: 'product' | 'category' | 'general' | 'none'; fixed: 'product' | 'none' };
  };
};
export type PricePreviewArgs = { id: string; face_value?: number; markup_bps?: number; customer_discount_bps?: number; fixed_price?: number };

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
    /** Lists or unlists products on your BitoCard-hosted store (at most 100 at a time). */
    setListing: build.mutation<{ object: 'listing_update'; listed: boolean; product_ids: string[]; updated: number }, { listed: boolean; product_ids: string[] }>({
      query: body => ({ url: '/v1/catalogue/listing', method: 'POST', body }),
      // Shown at once on every loaded catalogue page and product, undone if refused; nothing is refetched, so a
      // product that no longer matches a "listed" filter stays in view until the list is next refreshed.
      async onQueryStarted({ listed, product_ids }, { dispatch, getState, queryFulfilled }) {
        const ids = new Set(product_ids);
        const state = getState() as Parameters<typeof resellerCatalogueApi.util.selectCachedArgsForQuery>[0];
        const patches = [
          ...resellerCatalogueApi.util.selectCachedArgsForQuery(state, 'catalogueProducts').map(args =>
            dispatch(
              resellerCatalogueApi.util.updateQueryData('catalogueProducts', args, draft => {
                for (const product of draft.pages.flatMap(page => page.data)) if (ids.has(product.id)) product.listed = listed;
              }),
            ),
          ),
          ...product_ids.map(id => dispatch(resellerCatalogueApi.util.updateQueryData('catalogueProduct', id, draft => void (draft.listed = listed)))),
        ];
        await settleOptimistic(patches, queryFulfilled, () => dispatch(resellerCatalogueApi.util.invalidateTags(['Catalogue'])));
      },
    }),
    createQuote: build.mutation<Quote, CreateQuote>({ query: body => ({ url: '/v1/quotes', method: 'POST', body }) }),
    quote: build.query<Quote, string>({ query: id => `/v1/quotes/${id}` }),

    resellerPricing: build.query<Pricing, void>({ query: () => '/v1/pricing', providesTags: ['Pricing'] }),
    pricePreview: build.query<PricePreview, PricePreviewArgs>({
      query: ({ id, ...rest }) => ({ url: `/v1/catalogue/products/${id}/price-preview`, params: params(rest) }),
      providesTags: ['Pricing', 'Catalogue'],
    }),
    setMarkup: build.mutation<Pricing, MarkupInput>({
      query: body => ({ url: '/v1/pricing/markups', method: 'PUT', body }),
      invalidatesTags: ['Pricing', 'Catalogue'],
    }),
    removeMarkup: build.mutation<Pricing, { category?: CatalogueCategory | null; product_id?: string | null }>({
      query: args => ({ url: '/v1/pricing/markups', method: 'DELETE', params: params(args) }),
      invalidatesTags: ['Pricing', 'Catalogue'],
    }),
  }),
});

export const {
  useCatalogueProductsInfiniteQuery,
  useCatalogueProductQuery,
  useSetListingMutation,
  useCreateQuoteMutation,
  useQuoteQuery,
  useResellerPricingQuery,
  useSetMarkupMutation,
  usePricePreviewQuery,
  useRemoveMarkupMutation,
} = resellerCatalogueApi;
