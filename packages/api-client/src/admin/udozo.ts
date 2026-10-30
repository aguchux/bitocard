import { bitocardApi } from '../base';

// Udozo's own admin endpoints (docs/UDOZO_SPINOFF_PLAN.md, step 3), served only by Udozo's API instance
// (api.udozo.com); BitoCard's answers them as unknown routes. Plus the shared ones Udozo's admin reads that had no
// hook yet: the books check and a reseller's credit limit.

/** Four colours every Udozo app reads as its colour variables. `#rrggbb`. */
export type ThemeColors = { primary: string; accent: string; ink: string; page: string };
export type ThemeColorKey = keyof ThemeColors;

/** A theme: a ready-made one (`preset`) or the admins' own colours (`preset` null). */
export type SiteTheme = { preset: string | null; colors: ThemeColors };

/** `GET /v1/admin/theme`: the draft, what is live (null until first published), and the ready-made themes. */
export type ThemeSettings = {
  object: 'theme_settings';
  draft: SiteTheme;
  published: SiteTheme | null;
  version: number;
  published_at: string | null;
  presets: Array<{ key: string; name: string; colors: ThemeColors }>;
};

/** A signed link to preview the draft on udozo.com (`?theme_preview=<token>`), valid for a short while. */
export type ThemePreview = { object: 'theme_preview'; token: string; expires_at: string };

/** Saving the draft: a ready-made theme or four colours, never both. A colour that is not readable is `theme_contrast` (its `param` is `colors.<key>`). */
export type ThemeDraftInput = { preset: string } | { colors: ThemeColors };

/** One market's Seller HQ setup fee as admins see it. Money in the market's minor units. */
export type SetupFeeSetting = {
  object: 'setup_fee_setting';
  country: string;
  name: string;
  currency: string;
  /** `market`: the market's own fee; `every_market`: Udozo's fee for every market, converted at today's rate; null: none. */
  source: 'market' | 'every_market' | null;
  enabled: boolean;
  /** Null while Udozo's fee in US dollars cannot be converted (no exchange rate). */
  amount: number | null;
  /** One Premium month in the market's currency (its fixed price, else converted), or null when it cannot be priced. */
  premium_month: number | null;
  /** The dearest domain ending on offer, in the market's currency, or null when unknown. */
  dearest_domain: number | null;
  /** `fees_below_domain_price`: the fee (when on) plus one Premium month is less than the dearest domain ending. */
  warnings: Array<'fees_below_domain_price' | (string & {})>;
};

/** Udozo's setup fee for every market without its own, in US cents. */
export type SetupFeeDefault = { object: 'setup_fee_default'; currency: 'USD'; enabled: boolean; amount: number };
export type SetupFeeList = { object: 'list'; every_market: SetupFeeDefault; data: SetupFeeSetting[] };

/** `GET /v1/admin/ledger/check`: whether every balance matches its postings and every entry balances. */
export type LedgerCheck = {
  object: 'ledger_check';
  platform: string;
  ok: boolean;
  accounts_checked: number;
  account_mismatches: Array<{ account_id: string; balance: string; from_postings: string }>;
  unbalanced_entries: Array<{ entry_id: string; currency: string; off_by: string }>;
};

/** A reseller's credit limit (US cents) and what they owe, per currency, against it. */
export type ResellerCredit = {
  object: 'credit';
  limit_usd_cents: number;
  steps: number[];
  owed: Array<{ currency: string; amount: number; limit: number }>;
  next_limit_usd_cents: number | null;
  can_raise: boolean;
  raise_blocked_by: 'maximum' | 'owing' | 'no_paid_month' | null;
};

export const adminUdozoApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    // -- Theme (operations change it; publishing needs step-up) ---------------------------------------------------
    themeSettings: build.query<ThemeSettings, void>({ query: () => '/v1/admin/theme', providesTags: [{ type: 'Settings', id: 'THEME' }] }),
    saveThemeDraft: build.mutation<ThemeSettings, ThemeDraftInput>({
      query: body => ({ url: '/v1/admin/theme/draft', method: 'PUT', body }),
      invalidatesTags: [{ type: 'Settings', id: 'THEME' }],
    }),
    themePreview: build.mutation<ThemePreview, void>({ query: () => ({ url: '/v1/admin/theme/preview', method: 'POST' }) }),
    publishTheme: build.mutation<ThemeSettings, void>({
      query: () => ({ url: '/v1/admin/theme/publish', method: 'POST' }),
      invalidatesTags: [{ type: 'Settings', id: 'THEME' }, 'Activity'],
    }),

    // -- Seller HQ setup fees (finance change them, with step-up) -------------------------------------------------
    setupFees: build.query<SetupFeeList, void>({ query: () => '/v1/admin/setup-fees', providesTags: [{ type: 'Plan', id: 'SETUP_FEES' }] }),
    /** A market's fee (in its currency), or Udozo's for every market (`country: 'WW'`, in US cents). */
    setSetupFee: build.mutation<SetupFeeSetting | SetupFeeDefault, { country: string; enabled: boolean; amount: number }>({
      query: ({ country, ...body }) => ({ url: `/v1/admin/setup-fees/${country}`, method: 'PUT', body }),
      invalidatesTags: [{ type: 'Plan', id: 'SETUP_FEES' }, 'Activity'],
    }),
    /** The market goes back to Udozo's fee for every market. */
    clearSetupFee: build.mutation<SetupFeeSetting, string>({
      query: country => ({ url: `/v1/admin/setup-fees/${country}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Plan', id: 'SETUP_FEES' }, 'Activity'],
    }),

    // -- The books (finance) --------------------------------------------------------------------------------------
    ledgerCheck: build.query<LedgerCheck, void>({ query: () => '/v1/admin/ledger/check', providesTags: [{ type: 'Report', id: 'LEDGER' }] }),

    // -- A reseller's credit limit (finance set it, with step-up) -------------------------------------------------
    resellerCredit: build.query<ResellerCredit, string>({ query: id => `/v1/admin/resellers/${id}/credit`, providesTags: (_result, _error, id) => [{ type: 'Invoice', id: `CREDIT-${id}` }] }),
    setResellerCreditLimit: build.mutation<unknown, { id: string; cents: number; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/admin/resellers/${id}/credit-limit`, method: 'PUT', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'Invoice', id: `CREDIT-${id}` }, { type: 'Reseller', id }, 'Activity'],
    }),
  }),
});

export const {
  useThemeSettingsQuery,
  useSaveThemeDraftMutation,
  useThemePreviewMutation,
  usePublishThemeMutation,
  useSetupFeesQuery,
  useSetSetupFeeMutation,
  useClearSetupFeeMutation,
  useLedgerCheckQuery,
  useResellerCreditQuery,
  useSetResellerCreditLimitMutation,
} = adminUdozoApi;
