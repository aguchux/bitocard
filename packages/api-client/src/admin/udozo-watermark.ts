import { bitocardApi } from '../base';

// Udozo's photo watermarks (Udozo's API only; docs/UDOZO_WATERMARK_PLAN.md): Udozo's own text on listing photos, and
// the stores whose resellers set their own.

export { watermarkTextMax, watermarkTextPattern, watermarkTextProblem } from '../watermark';

/** Udozo's text, drawn on udozo.com's photos and on stores without their own. `version` adds 1 on every change. */
export type WatermarkSettings = {
  object: 'watermark_settings';
  text: string;
  version: number;
  updated_at: string | null;
  /** Who last changed it, when an admin has. */
  updated_by?: { id: string; name: string } | null;
};

/** A store whose reseller set its own watermark text. */
export type StoreWatermark = {
  object: 'store_watermark';
  /** The store's ID. */
  id: string;
  name: string;
  /** The store's live address (its primary domain, else its subdomain). */
  address: string;
  reseller: { id: string; name: string };
  watermark_text: string;
  updated_at: string | null;
};

const settingsTag = { type: 'Settings' as const, id: 'WATERMARK' };
const storesTag = { type: 'Settings' as const, id: 'WATERMARK_STORES' };

export const adminUdozoWatermarkApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    watermarkSettings: build.query<WatermarkSettings, void>({ query: () => '/v1/admin/classifieds/watermark', providesTags: [settingsTag] }),
    /** Operations: Udozo's text (2 to 30 letters, digits, spaces and . - _ @). Audited `watermark.changed`. */
    updateWatermarkSettings: build.mutation<WatermarkSettings, { text: string }>({
      query: body => ({ url: '/v1/admin/classifieds/watermark', method: 'PUT', body }),
      invalidatesTags: [settingsTag, 'Activity'],
    }),
    storeWatermarks: build.query<{ object: 'list'; data: StoreWatermark[] }, void>({ query: () => '/v1/admin/classifieds/watermark/stores', providesTags: [storesTag] }),
    /** Operations: clears a store's own text (its photos go back to Udozo's), with the reason; the reseller is told. */
    clearStoreWatermark: build.mutation<unknown, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/admin/stores/${id}/watermark`, method: 'DELETE', body: { reason } }),
      invalidatesTags: [storesTag, 'Reseller', 'Activity'],
    }),
  }),
});

export const { useWatermarkSettingsQuery, useUpdateWatermarkSettingsMutation, useStoreWatermarksQuery, useClearStoreWatermarkMutation } = adminUdozoWatermarkApi;
