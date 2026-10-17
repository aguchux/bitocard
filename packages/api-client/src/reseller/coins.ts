import { bitocardApi } from '../base';
import type { List, Mode } from './common';

/**
 * A Premium reseller's own coins on chain (`/v1/crypto`, SHQ sessions only): the coin wallet it trades with BitoCard
 * from, deposit addresses and deposits, saved withdrawal addresses and withdrawals confirmed with an emailed code.
 * Typed by hand against `ResellerCoinsService` and the deposit and withdrawal presenters. Amounts are decimal strings.
 */

/** `GET /v1/crypto`: the coin wallet per coin. `onchain` is the Premium feature that opens deposits and withdrawals. */
export type ResellerCoins = {
  object: 'reseller_coins';
  mode: Mode;
  onchain: boolean;
  assets: Array<{
    asset: string;
    name: string;
    decimals: number;
    enabled: boolean;
    available: string;
    withdrawing: string;
  }>;
};

/** A network a coin can be deposited on now. `token` is the token standard (ERC-20, TRC-20…), null for a chain's own coin. */
export type CoinDepositNetwork = {
  object: 'crypto_network';
  asset: string;
  chain: string;
  name: string;
  token: string | null;
  confirmations: number;
};

export type CoinDepositAddress = {
  object: 'crypto_deposit_address';
  mode: Mode;
  asset: string;
  chain: string;
  network: string;
  address: string;
  /** The token contract to check against, null for a chain's own coin. */
  contract: string | null;
  confirmations: number;
  watch_until: string;
};

export type CoinDepositStatus = 'pending' | 'credited' | 'ignored' | 'failed';
export type CoinDeposit = {
  object: 'crypto_deposit';
  id: string;
  mode: Mode;
  asset: string;
  chain: string;
  network: string;
  tx_hash: string;
  amount: string;
  status: CoinDepositStatus;
  confirmations: number;
  confirmations_needed: number | null;
  created_at: string;
  credited_at: string | null;
};

/** A saved address coins can be sent to; usable from `usable_from` (24 hours after it was added). */
export type CoinWithdrawalAddress = {
  object: 'crypto_withdrawal_address';
  id: string;
  mode: Mode;
  chain: string;
  network: string;
  address: string;
  label: string;
  usable_from: string;
  ready: boolean;
  created_at: string;
};

export type CoinWithdrawalNetworks = {
  object: 'crypto_withdrawal_networks';
  asset: string;
  daily_limit: string;
  remaining_today: string;
  data: Array<{
    object: 'crypto_network';
    chain: string;
    name: string;
    fee: string;
    minimum: string;
    confirmations: number;
  }>;
};

export type CoinWithdrawalPreview = {
  object: 'crypto_withdrawal_preview';
  mode: Mode;
  asset: string;
  chain: string;
  network: string;
  address: string;
  amount: string;
  fee: string;
  total: string;
  needs_approval: boolean;
};

export type CoinWithdrawalStatus = 'awaiting_code' | 'review' | 'queued' | 'submitting' | 'broadcast' | 'completed' | 'failed' | 'rejected' | 'cancelled';
export type CoinWithdrawal = {
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
  status: CoinWithdrawalStatus;
  review_reason: 'amount' | 'unscreened' | 'recent_card_top_up' | null;
  tx_hash: string | null;
  confirmations: number;
  created_at: string;
  completed_at: string | null;
};

export type CoinWithdrawalInput = {
  asset: string;
  chain: string;
  address_id: string;
  amount: string;
};

/** Moving coins changes the coin wallet the exchange pages read too, so both tags go. */
const coinsChanged = ['Crypto', 'Exchange'] as const;

export const resellerCoinsApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    resellerCoins: build.query<ResellerCoins, void>({
      query: () => '/v1/crypto',
      providesTags: ['Crypto', 'Exchange'],
    }),
    coinDepositNetworks: build.query<List<CoinDepositNetwork>, string>({
      query: asset => ({
        url: '/v1/crypto/deposit-networks',
        params: { asset },
      }),
      providesTags: ['Crypto'],
    }),
    /** Issues (or shows again) the business's address for a coin on a network. Watches it for deposits for a week. */
    coinDepositAddress: build.mutation<CoinDepositAddress, { asset: string; chain: string }>({
      query: body => ({
        url: '/v1/crypto/deposit-addresses',
        method: 'POST',
        body,
      }),
    }),
    coinDeposits: build.query<List<CoinDeposit>, void>({
      query: () => '/v1/crypto/deposits',
      providesTags: ['Crypto'],
    }),
    coinWithdrawalAddresses: build.query<List<CoinWithdrawalAddress>, void>({
      query: () => '/v1/crypto/withdrawal-addresses',
      providesTags: ['Crypto'],
    }),
    addCoinWithdrawalAddress: build.mutation<CoinWithdrawalAddress, { chain: string; address: string; label: string }>({
      query: body => ({
        url: '/v1/crypto/withdrawal-addresses',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['Crypto'],
    }),
    removeCoinWithdrawalAddress: build.mutation<{ object: 'crypto_withdrawal_address'; id: string; deleted: true }, string>({
      query: id => ({
        url: `/v1/crypto/withdrawal-addresses/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['Crypto'],
    }),
    coinWithdrawalNetworks: build.query<CoinWithdrawalNetworks, string>({
      query: asset => ({
        url: '/v1/crypto/withdrawal-networks',
        params: { asset },
      }),
      providesTags: ['Crypto'],
    }),
    /** Only quotes: the fee, the total and whether BitoCard must approve it. Nothing moves. */
    previewCoinWithdrawal: build.mutation<CoinWithdrawalPreview, CoinWithdrawalInput>({
      query: body => ({
        url: '/v1/crypto/withdrawals',
        method: 'POST',
        body: { ...body, preview: true },
      }),
    }),
    /** Asks for it: the amount and fee leave the coin wallet and a 6-digit code is emailed to the person asking. */
    createCoinWithdrawal: build.mutation<CoinWithdrawal, CoinWithdrawalInput>({
      query: body => ({
        url: '/v1/crypto/withdrawals',
        method: 'POST',
        body,
      }),
      invalidatesTags: [...coinsChanged],
    }),
    coinWithdrawals: build.query<List<CoinWithdrawal>, void>({
      query: () => '/v1/crypto/withdrawals',
      providesTags: ['Crypto'],
    }),
    coinWithdrawal: build.query<CoinWithdrawal, string>({
      query: id => `/v1/crypto/withdrawals/${id}`,
      providesTags: ['Crypto'],
    }),
    confirmCoinWithdrawal: build.mutation<CoinWithdrawal, { id: string; code: string }>({
      query: ({ id, code }) => ({
        url: `/v1/crypto/withdrawals/${id}/confirm`,
        method: 'POST',
        body: { code },
      }),
      invalidatesTags: [...coinsChanged],
    }),
    resendCoinWithdrawalCode: build.mutation<CoinWithdrawal, string>({
      query: id => ({
        url: `/v1/crypto/withdrawals/${id}/resend-code`,
        method: 'POST',
      }),
    }),
    /** Gives the coins back while the withdrawal waits for its code or BitoCard's review. */
    cancelCoinWithdrawal: build.mutation<CoinWithdrawal, string>({
      query: id => ({
        url: `/v1/crypto/withdrawals/${id}/cancel`,
        method: 'POST',
      }),
      invalidatesTags: [...coinsChanged],
    }),
  }),
});

export const {
  useResellerCoinsQuery,
  useCoinDepositNetworksQuery,
  useCoinDepositAddressMutation,
  useCoinDepositsQuery,
  useCoinWithdrawalAddressesQuery,
  useAddCoinWithdrawalAddressMutation,
  useRemoveCoinWithdrawalAddressMutation,
  useCoinWithdrawalNetworksQuery,
  usePreviewCoinWithdrawalMutation,
  useCreateCoinWithdrawalMutation,
  useCoinWithdrawalsQuery,
  useCoinWithdrawalQuery,
  useConfirmCoinWithdrawalMutation,
  useResendCoinWithdrawalCodeMutation,
  useCancelCoinWithdrawalMutation,
} = resellerCoinsApi;
