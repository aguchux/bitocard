import { bitocardApi } from '../base';
import type { List, Mode } from './types';

/** A crypto asset customers can hold and trade. `p2p_fee_bps`: BitoCard's fee, taken in the asset from the buyer. */
/** `withdrawal_daily_limit`: the most one customer withdraws on chain in 24 hours; from `withdrawal_review_from` an admin approves. */
export type CryptoAsset = {
  object: 'crypto_asset';
  code: string;
  name: string;
  decimals: number;
  enabled: boolean;
  p2p_fee_bps: number;
  withdrawal_daily_limit: string;
  withdrawal_review_from: string;
};

/** Crypto amounts are decimal strings with every place ("12.500000"). */
export type CryptoBalance = { object: 'crypto_balance'; asset: string; name: string; decimals: number; available: string; locked: string; frozen: string; withdrawing: string; total: string };

export type CryptoFreeze = {
  object: 'crypto_freeze';
  id: string;
  mode: Mode;
  asset: string;
  amount: string;
  reason: string;
  status: 'frozen' | 'released' | 'seized';
  resolve_note: string | null;
  created_at: string;
  resolved_at: string | null;
};

export type CryptoCustomer = {
  object: 'crypto_customer';
  id: string;
  email: string;
  name: string;
  country: string | null;
  store: { name: string; subdomain: string };
  nickname: string | null;
  frozen: boolean;
  frozen_reason: string | null;
  frozen_at: string | null;
};

export type CryptoCustomerDetail = CryptoCustomer & {
  balances: { live: CryptoBalance[]; test: CryptoBalance[] };
  freezes: CryptoFreeze[];
};

export type P2pAd = {
  object: 'p2p_ad';
  id: string;
  mode: Mode;
  side: 'buy' | 'sell';
  asset: string;
  decimals: number;
  currency: string;
  country: string;
  /** Fiat minor units per whole unit. */
  price: number;
  available: string;
  total: string;
  filled: string;
  min_fiat: number;
  max_fiat: number;
  terms: string | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  trader: { nickname: string; trades_30d: number; trades_total: number };
  customer: { id: string; email: string | null };
  created_at: string;
  updated_at: string;
};

export type ChainRoute = {
  object: 'chain_route';
  chain: string;
  provider: string;
  name: string;
  priority: number;
  enabled: boolean;
  /** Credentials saved for this chain (Settings > Integrations > Blockchain). */
  configured: boolean;
  /** live: main network for live stores; sandbox: test network for sandbox stores. */
  environment: 'live' | 'sandbox';
  lists_deposits: boolean;
  finds_coin_deposits: boolean;
  webhooks: boolean;
  last_block: string | null;
  last_error: string | null;
  checked_at: string | null;
};

export type CryptoNetworkSetting = {
  object: 'crypto_network_setting';
  id: string;
  asset: string;
  chain: string;
  contract: string | null;
  test_contract: string | null;
  decimals: number;
  confirmations: number;
  deposits_enabled: boolean;
  /** Deposits from this amount wait for a second provider to agree. */
  double_check_from: string;
  withdrawals_enabled: boolean;
  /** BitoCard's network fee per withdrawal, on top of the amount sent. */
  withdrawal_fee: string;
  min_withdrawal: string;
};

export type ChainView = { object: 'chain'; chain: string; name: string; family: string; keys: { live: boolean; test: boolean }; routes: ChainRoute[]; networks: CryptoNetworkSetting[] };

export type CryptoDeposit = {
  object: 'crypto_deposit';
  id: string;
  mode: Mode;
  asset: string;
  chain: string;
  network: string;
  tx_hash: string;
  amount: string;
  status: 'pending' | 'credited' | 'ignored' | 'failed';
  confirmations: number;
  confirmations_needed: number | null;
  address: string;
  confirmed_by: string[];
  /** Whose coins. */
  customer: { id: string; email: string };
  created_at: string;
  credited_at: string | null;
};

export type CryptoWithdrawalStatus = 'awaiting_code' | 'review' | 'queued' | 'submitting' | 'broadcast' | 'completed' | 'failed' | 'rejected' | 'cancelled';

/** An on-chain withdrawal: sent by BitoCard's signer under `signer_reference`, settled once confirmed on chain. */
export type CryptoWithdrawal = {
  object: 'crypto_withdrawal';
  id: string;
  number: string;
  mode: Mode;
  asset: string;
  chain: string;
  network: string;
  address: string;
  amount: string;
  fee: string;
  total: string;
  status: CryptoWithdrawalStatus;
  /** amount, unscreened or recent_card_top_up while it waits for review. */
  review_reason: string | null;
  tx_hash: string | null;
  confirmations: number;
  created_at: string;
  completed_at: string | null;
  /** Whose coins. */
  customer: { id: string; email: string };
  screening: 'clear' | 'flagged' | 'unscreened' | null;
  screened_by: string | null;
  signer_reference: string;
  attempts: number;
  error: string | null;
  /** Waited too long for the signer or the chain: admins were told. */
  needs_review: boolean;
  reviewed_at: string | null;
  review_note: string | null;
};

/** A store customer's payout of their P2P money to their bank account. */
export type CustomerPayout = {
  object: 'customer_payout';
  id: string;
  mode: Mode;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  amount: number;
  currency: string;
  bank_account: { bank_name: string; account_number_last4: string } | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
  customer: { id: string; email: string };
  account_name: string;
  reference: string;
  provider: string;
  /** Its outcome stayed unclear for an hour: finance was told. */
  needs_review: boolean;
};

/** One asset's custody check: what the ledger expects on chain against what the signer's wallets hold. */
export type CryptoReconciliation = {
  object: 'crypto_reconciliation';
  id: string;
  mode: Mode;
  asset: string;
  expected: string;
  held: string;
  /** held - expected: negative is a shortfall. */
  difference: string;
  status: 'matched' | 'surplus' | 'shortfall' | 'unavailable';
  detail: { custody: string; withdrawals_in_flight: string; deposits_arriving: string; chains: Record<string, string>; error?: string };
  created_at: string;
};

export type P2pFilter = { mode?: Mode; status?: string; asset?: string; customer_id?: string; limit?: number };

const cryptoApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    cryptoAssets: build.query<List<CryptoAsset>, void>({ query: () => '/v1/afrippa/admin/crypto/assets', providesTags: ['Crypto'] }),
    updateCryptoAsset: build.mutation<
      CryptoAsset,
      { code: string; enabled?: boolean; p2p_fee_bps?: number; withdrawal_daily_limit?: string; withdrawal_review_from?: string }
    >({
      query: ({ code, ...body }) => ({ url: `/v1/afrippa/admin/crypto/assets/${code}`, method: 'PATCH', body }),
      invalidatesTags: ['Crypto'],
    }),
    cryptoCustomers: build.query<List<CryptoCustomer>, { q?: string }>({ query: params => ({ url: '/v1/afrippa/admin/crypto/customers', params }), providesTags: ['Crypto'] }),
    cryptoCustomer: build.query<CryptoCustomerDetail, string>({ query: id => `/v1/afrippa/admin/crypto/customers/${id}`, providesTags: ['Crypto'] }),
    creditTestCrypto: build.mutation<CryptoCustomerDetail, { id: string; asset: string; amount: string; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/afrippa/admin/crypto/customers/${id}/test-credits`, method: 'POST', body }),
      invalidatesTags: ['Crypto'],
    }),
    freezeCrypto: build.mutation<CryptoFreeze, { id: string; asset: string; amount: string; reason: string; mode: Mode }>({
      query: ({ id, ...body }) => ({ url: `/v1/afrippa/admin/crypto/customers/${id}/freezes`, method: 'POST', body }),
      invalidatesTags: ['Crypto'],
    }),
    resolveCryptoFreeze: build.mutation<CryptoFreeze, { id: string; outcome: 'release' | 'seize'; note: string }>({
      query: ({ id, outcome, note }) => ({ url: `/v1/afrippa/admin/crypto/freezes/${id}/${outcome}`, method: 'POST', body: { note } }),
      invalidatesTags: ['Crypto'],
    }),
    setCryptoAccountFrozen: build.mutation<CryptoCustomerDetail, { id: string; frozen: boolean; reason: string }>({
      query: ({ id, ...body }) => ({ url: `/v1/afrippa/admin/crypto/customers/${id}/account-freeze`, method: 'PUT', body }),
      invalidatesTags: ['Crypto', 'P2p'],
    }),
    chains: build.query<List<ChainView>, void>({ query: () => '/v1/afrippa/admin/crypto/chains', providesTags: ['Crypto'] }),
    setChainRoutes: build.mutation<List<ChainView>, { chain: string; order: string[]; disabled: string[] }>({
      query: ({ chain, ...body }) => ({ url: `/v1/afrippa/admin/crypto/chains/${chain}/routes`, method: 'PUT', body }),
      invalidatesTags: ['Crypto'],
    }),
    checkChains: build.mutation<unknown, void>({ query: () => ({ url: '/v1/afrippa/admin/crypto/chains/check', method: 'POST' }), invalidatesTags: ['Crypto'] }),
    updateCryptoNetwork: build.mutation<
      CryptoNetworkSetting,
      {
        id: string;
        deposits_enabled?: boolean;
        confirmations?: number;
        contract?: string | null;
        test_contract?: string | null;
        double_check_from?: string;
        withdrawals_enabled?: boolean;
        withdrawal_fee?: string;
        min_withdrawal?: string;
      }
    >({
      query: ({ id, ...body }) => ({ url: `/v1/afrippa/admin/crypto/networks/${id}`, method: 'PATCH', body }),
      invalidatesTags: ['Crypto'],
    }),
    cryptoDeposits: build.query<List<CryptoDeposit>, { mode?: Mode; status?: string; customer_id?: string }>({ query: params => ({ url: '/v1/afrippa/admin/crypto/deposits', params }), providesTags: ['Crypto'] }),
    recheckCryptoDeposit: build.mutation<CryptoDeposit, string>({ query: id => ({ url: `/v1/afrippa/admin/crypto/deposits/${id}/recheck`, method: 'POST' }), invalidatesTags: ['Crypto'] }),
    cryptoWithdrawals: build.query<List<CryptoWithdrawal>, { mode?: Mode; status?: string; customer_id?: string }>({ query: params => ({ url: '/v1/afrippa/admin/crypto/withdrawals', params }), providesTags: ['Crypto'] }),
    decideCryptoWithdrawal: build.mutation<CryptoWithdrawal, { id: string; decision: 'approve' | 'reject'; note: string }>({
      query: ({ id, decision, note }) => ({ url: `/v1/afrippa/admin/crypto/withdrawals/${id}/${decision}`, method: 'POST', body: { note } }),
      invalidatesTags: ['Crypto'],
    }),
    recheckCryptoWithdrawal: build.mutation<CryptoWithdrawal, string>({ query: id => ({ url: `/v1/afrippa/admin/crypto/withdrawals/${id}/recheck`, method: 'POST' }), invalidatesTags: ['Crypto'] }),
    customerPayouts: build.query<List<CustomerPayout>, { mode?: Mode; status?: string; customer_id?: string }>({ query: params => ({ url: '/v1/admin/customer-payouts', params }), providesTags: ['Crypto'] }),
    cryptoReconciliations: build.query<List<CryptoReconciliation>, Mode>({ query: mode => ({ url: '/v1/afrippa/admin/crypto/reconciliations', params: { mode } }), providesTags: ['Crypto'] }),
    runCryptoReconciliation: build.mutation<{ object: 'crypto_reconciliation_run'; error: string | null; data: CryptoReconciliation[] }, Mode>({
      query: mode => ({ url: '/v1/afrippa/admin/crypto/reconciliations/run', method: 'POST', body: { mode } }),
      invalidatesTags: ['Crypto'],
    }),
    p2pAds: build.query<List<P2pAd>, P2pFilter>({ query: params => ({ url: '/v1/afrippa/admin/p2p/ads', params }), providesTags: ['P2p'] }),
    cancelP2pAd: build.mutation<P2pAd, { id: string; reason: string }>({
      query: ({ id, reason }) => ({ url: `/v1/afrippa/admin/p2p/ads/${id}/cancel`, method: 'POST', body: { reason } }),
      invalidatesTags: ['P2p', 'Crypto'],
    }),
  }),
});

export const {
  useCryptoAssetsQuery,
  useUpdateCryptoAssetMutation,
  useCryptoCustomersQuery,
  useCryptoCustomerQuery,
  useCreditTestCryptoMutation,
  useFreezeCryptoMutation,
  useResolveCryptoFreezeMutation,
  useSetCryptoAccountFrozenMutation,
  useP2pAdsQuery,
  useCancelP2pAdMutation,
  useChainsQuery,
  useSetChainRoutesMutation,
  useCheckChainsMutation,
  useUpdateCryptoNetworkMutation,
  useCryptoDepositsQuery,
  useRecheckCryptoDepositMutation,
  useCryptoWithdrawalsQuery,
  useDecideCryptoWithdrawalMutation,
  useRecheckCryptoWithdrawalMutation,
  useCustomerPayoutsQuery,
  useCryptoReconciliationsQuery,
  useRunCryptoReconciliationMutation,
} = cryptoApi;
