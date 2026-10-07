import { bitocardApi } from '../base';
import { settleOptimistic } from '../optimistic';
import type { List } from './types';

export const stockCategories = ['gift_cards', 'software'] as const;
export type StockCategory = (typeof stockCategories)[number];
export type StockCodeStatus = 'available' | 'sold' | 'withdrawn';

/** One product in BitoCard's own stock, with how many codes it holds. Codes themselves are never returned. */
export type StockItem = {
  object: 'stock_item';
  id: string;
  product: {
    id: string;
    key: string;
    category: StockCategory;
    country: string;
    brand: string;
    name: string;
    description: string | null;
    redeem_instructions: string | null;
    image_url: string | null;
    face_currency: string;
    /** Minor units. */
    face_value: number;
    active: boolean;
    listed: boolean;
  };
  currency: string;
  /** Software: the licence term in months (0 for lifetime); null for gift cards. */
  duration_months: number | null;
  /** What BitoCard paid for one code, minor units. */
  cost: number;
  /** This product's own margin rule, or null when the category or default rule applies. */
  margin_bps: number | null;
  on_sale: boolean;
  paused: boolean;
  codes: { available: number; sold: number; withdrawn: number };
  created_at: string;
};

/** A code as admins see it: only its last four characters. */
export type StockCode = {
  object: 'stock_code';
  id: string;
  hint: string;
  has_pin: boolean;
  status: StockCodeStatus;
  order_id: string | null;
  created_at: string;
  sold_at: string | null;
  withdrawn_at: string | null;
};

export type StockCodeInput = { code: string; pin?: string };
export type StockItemInput = {
  category: StockCategory;
  /** Gift cards: where the card works. Software is global (`WW`). */
  country?: string;
  /** A brand's slug from Catalog > Brands. */
  brand: string;
  /** Software: the licence term in months, 0 for lifetime. */
  duration_months?: number;
  title: string;
  description?: string;
  redeem_instructions?: string;
  currency: string;
  face_value: number;
  cost: number;
  margin_bps?: number;
  image_url?: string;
  listed?: boolean;
  codes?: StockCodeInput[];
};
/** How many codes were stored, and how many were skipped because they are already stocked. */
export type StockAdded = StockItem & { added: number; duplicates: number };

export const adminStockApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    stock: build.query<List<StockItem>, { category?: StockCategory; q?: string }>({
      query: params => ({ url: '/v1/admin/stock', params }),
      providesTags: ['Stock'],
    }),
    createStock: build.mutation<StockAdded, StockItemInput>({
      query: body => ({ url: '/v1/admin/stock', method: 'POST', body }),
      invalidatesTags: ['Stock', { type: 'Product', id: 'LIST' }, 'Activity'],
    }),
    updateStock: build.mutation<StockItem, { id: string; cost?: number; margin_bps?: number | null; on_sale?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/stock/${id}`, method: 'PATCH', body }),
      // Shown at once (pausing or resuming sales), then the saved item replaces it in every loaded stock list.
      async onQueryStarted({ id, ...change }, { dispatch, getState, queryFulfilled }) {
        const patchItem = (values: Partial<StockItem>) =>
          adminStockApi.util.selectCachedArgsForQuery(getState() as Parameters<typeof adminStockApi.util.selectCachedArgsForQuery>[0], 'stock').map(args =>
            dispatch(
              adminStockApi.util.updateQueryData('stock', args, draft => {
                const item = draft.data.find(row => row.id === id);
                if (item) Object.assign(item, values);
              }),
            ),
          );
        const saved = await settleOptimistic(patchItem(change), queryFulfilled, () => dispatch(adminStockApi.util.invalidateTags(['Stock'])));
        if (saved) patchItem(saved);
      },
      invalidatesTags: [{ type: 'Product', id: 'LIST' }, 'Activity'],
    }),
    stockCodes: build.query<List<StockCode>, { id: string; status?: StockCodeStatus }>({
      query: ({ id, status }) => ({ url: `/v1/admin/stock/${id}/codes`, params: { limit: 100, ...(status ? { status } : {}) } }),
      providesTags: ['Stock'],
    }),
    addStockCodes: build.mutation<StockAdded, { id: string; codes: StockCodeInput[] }>({
      query: ({ id, codes }) => ({ url: `/v1/admin/stock/${id}/codes`, method: 'POST', body: { codes } }),
      invalidatesTags: ['Stock', { type: 'Product', id: 'LIST' }, 'Activity'],
    }),
    withdrawStockCode: build.mutation<StockItem, { id: string; codeId: string; reason: string }>({
      query: ({ id, codeId, reason }) => ({ url: `/v1/admin/stock/${id}/codes/${codeId}/withdraw`, method: 'POST', body: { reason } }),
      invalidatesTags: ['Stock', { type: 'Product', id: 'LIST' }, 'Activity'],
    }),
  }),
});

export const { useStockQuery, useCreateStockMutation, useUpdateStockMutation, useStockCodesQuery, useAddStockCodesMutation, useWithdrawStockCodeMutation } = adminStockApi;

/**
 * Codes pasted one per line, optionally `code | pin` (or a tab or comma before the PIN). Blank lines are skipped and
 * repeats within the paste are kept once.
 */
export function parseStockCodes(text: string): StockCodeInput[] {
  const seen = new Set<string>();
  const codes: StockCodeInput[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [code, pin] = line.split(/\s*[|\t,]\s*/).map(part => part.trim());
    if (!code || seen.has(code)) continue;
    seen.add(code);
    codes.push(pin ? { code, pin } : { code });
  }
  return codes;
}

/** Licence terms offered when stocking software, in months (0 is lifetime). */
export const licenceTerms = [1, 3, 6, 12, 24, 36, 0] as const;

/** A licence term as people read it: `Lifetime`, `1 month`, `6 months`, `1 year`, `2 years`. */
export const termLabel = (months: number) => (months === 0 ? 'Lifetime' : months % 12 === 0 ? (months === 12 ? '1 year' : `${months / 12} years`) : months === 1 ? '1 month' : `${months} months`);

/** Licence keys pasted one per line (blank lines ignored, duplicates kept once). */
export const parseLicenceKeys = (text: string): StockCodeInput[] => [...new Set(text.split(/\r?\n/).map(line => line.trim()).filter(Boolean))].map(code => ({ code }));
