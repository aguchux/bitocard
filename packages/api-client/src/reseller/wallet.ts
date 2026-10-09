import { bitocardApi } from '../base';
import { cursorPages, type List, type Mode, params } from './common';

/**
 * The reseller wallet (`/v1/wallet`): balances, ledger transactions, checkout top-ups and reserved bank accounts, plus
 * BitoCard's public exchange rates. Amounts are integer minor units of the wallet currency.
 */
export type Wallet = {
  object: 'wallet';
  mode: Mode;
  currency: string;
  /** Can pay wholesale cost now: topped-up funds plus withdrawable earnings. */
  available: number;
  /** Held for orders in progress. */
  reserved: number;
  earnings: {
    /** Past the payout hold: spendable and withdrawable. */
    withdrawable: number;
    /** Still inside the payout hold. */
    on_hold: number;
    /** When the next held earnings become withdrawable, if any are held. */
    next_release_at: string | null;
  };
  /** Withdrawals on their way to the bank. */
  payouts_in_progress: number;
  /** The country's smallest withdrawal. */
  minimum_withdrawal: number;
  /** Live only; null if never granted. Never part of `available`. */
  startup_allowance: StartupAllowance | null;
};

/** Journal entry types the ledger posts against a reseller. */
export type WalletTransactionType =
  | 'top_up'
  | 'deposit'
  | 'hold'
  | 'hold_release'
  | 'hold_capture'
  | 'earnings'
  | 'earnings_release'
  | 'payout'
  | 'payout_reversal'
  | 'payout_fee'
  | 'adjustment'
  | 'plan_charge'
  | 'allowance_granted'
  | 'allowance_revoked'
  | 'platform_fee'
  | 'platform_fee_refund'
  | (string & {});

/** The $500 startup allowance (US cents). Restricted: pays only the wholesale cost of customer-paid orders, never cash. */
export type StartupAllowance = {
  currency: 'USD';
  granted: number;
  remaining: number;
  status: 'active' | 'used' | 'revoked';
  granted_at: string;
  revoked_at: string | null;
};

export type WalletTransaction = {
  object: 'wallet_transaction';
  id: string;
  type: WalletTransactionType;
  description: string;
  currency: string | null;
  /** Change to the money available to spend. */
  amount: number;
  /** Change to money held for orders in progress. */
  reserved_change: number;
  /** Change to earnings still inside the payout hold. */
  earnings_on_hold_change: number;
  /** Change to the startup allowance (US cents); never part of `amount`. */
  allowance_change: number;
  /** BitoCard fee entries (and the fee hold returned before them): the fee and what it was on. */
  fee: { id: string; source: { type: string; id: string | null } | null } | null;
  created_at: string;
};

export type ExchangeRate = {
  object: 'exchange_rate';
  base: 'USD';
  currency: string;
  /** False while BitoCard has paused conversions for the currency (then the rates are null). */
  available: boolean;
  /** Units of the currency charged per US dollar (decimal string). */
  pay: string | null;
  /** Units of the currency received per US dollar (decimal string). */
  receive: string | null;
  margin_percent: number;
  as_of: string | null;
};

export type TopUpStatus = 'pending' | 'succeeded' | 'failed';

/** The payment gateways BitoCard offers per market. */
export type PaymentGateway = 'stripe' | 'flutterwave' | 'monnify' | 'pawapay';

/** A way to pay that BitoCard offers in the reseller's market (`GET /v1/wallet/payment-methods`). */
export type PaymentMethod = { object: 'payment_method'; id: PaymentGateway; label: string; description: string };

export type TopUp = {
  object: 'top_up';
  id: string;
  mode: Mode;
  status: TopUpStatus;
  /** checkout (card or another payment page) or bank_transfer (into a reserved bank account). */
  source: 'checkout' | 'bank_transfer';
  amount: number;
  currency: string;
  /** How it was paid: a gateway, or `sandbox` in test mode. */
  method: PaymentGateway | 'sandbox';
  /** The payment page, while the top-up is pending. */
  checkout_url: string | null;
  failure_reason: string | null;
  created_at: string;
  completed_at: string | null;
};

export type ReservedAccount = {
  object: 'reserved_account';
  id: string;
  mode: Mode;
  currency: string;
  bank_name: string;
  account_number: string;
  account_name: string;
  created_at: string;
};

export type SimulatedDeposit = { object: 'simulated_deposit'; credited: boolean; amount: number; currency: string };

/** A card payment the cardholder disputed with their bank (a chargeback). Its amount is held while open, and withdrawals wait. */
export type Chargeback = {
  object: 'chargeback';
  id: string;
  mode: Mode;
  payment_id: string;
  amount: number;
  currency: string;
  status: 'open' | 'won' | 'lost';
  /** Chargeback protection (Premium): nothing held, BitoCard bears a loss. */
  protected: boolean;
  held: number;
  shortfall: number;
  payouts_on_hold: boolean;
  opened_at: string;
  resolved_at: string | null;
};

export const resellerWalletApi = bitocardApi.injectEndpoints({
  endpoints: build => ({
    wallet: build.query<Wallet, void>({ query: () => '/v1/wallet', providesTags: ['Wallet'] }),
    walletChargebacks: build.query<List<Chargeback>, void>({ query: () => ({ url: '/v1/wallet/chargebacks', params: { limit: 50 } }), providesTags: ['Wallet'] }),
    walletTransactions: build.infiniteQuery<List<WalletTransaction>, void, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ pageParam }) => ({ url: '/v1/wallet/transactions', params: params({ limit: 25, starting_after: pageParam }) }),
      providesTags: ['Wallet'],
    }),
    exchangeRates: build.query<List<ExchangeRate>, void>({ query: () => '/v1/exchange-rates' }),

    topUps: build.infiniteQuery<List<TopUp>, void, string>({
      infiniteQueryOptions: cursorPages,
      query: ({ pageParam }) => ({ url: '/v1/wallet/top-ups', params: params({ limit: 25, starting_after: pageParam }) }),
      providesTags: [{ type: 'TopUp', id: 'LIST' }],
    }),
    topUp: build.query<TopUp, string>({ query: id => `/v1/wallet/top-ups/${id}`, providesTags: (_result, _error, id) => [{ type: 'TopUp', id }] }),
    /** The ways to top up in the reseller's market, best first. */
    topUpMethods: build.query<{ object: 'list'; data: PaymentMethod[] }, void>({ query: () => '/v1/wallet/payment-methods', providesTags: [{ type: 'TopUp', id: 'METHODS' }] }),
    /** Returns the top-up with its `checkout_url`; send the payer there. `method` is one of `topUpMethods` (default: the first). */
    createTopUp: build.mutation<TopUp, { amount: number; method?: PaymentGateway; return_url?: string }>({
      query: body => ({ url: '/v1/wallet/top-ups', method: 'POST', body }),
      invalidatesTags: [{ type: 'TopUp', id: 'LIST' }],
    }),
    /** Sandbox only. */
    simulateTopUp: build.mutation<TopUp, { id: string; outcome: 'succeeded' | 'failed' }>({
      query: ({ id, ...body }) => ({ url: `/v1/wallet/top-ups/${id}/simulate`, method: 'POST', body }),
      invalidatesTags: (_result, _error, { id }) => [{ type: 'TopUp', id }, { type: 'TopUp', id: 'LIST' }, 'Wallet'],
    }),

    reservedAccounts: build.query<List<ReservedAccount>, void>({ query: () => '/v1/wallet/reserved-accounts', providesTags: ['ReservedAccount'] }),
    /** Where the country offers them. Nigeria needs the owner's BVN, passed to the bank and never stored. Asking again returns the existing accounts. */
    /** Live accounts need BitoCard's switch, and in Nigeria a passed BVN check (see `useStartBvnCheckMutation`). */
    createReservedAccounts: build.mutation<List<ReservedAccount>, void>({
      query: () => ({ url: '/v1/wallet/reserved-accounts', method: 'POST' }),
      invalidatesTags: ['ReservedAccount'],
    }),
    /** Sandbox only. */
    simulateDeposit: build.mutation<SimulatedDeposit, { id: string; amount: number }>({
      query: ({ id, ...body }) => ({ url: `/v1/wallet/reserved-accounts/${id}/simulate-deposit`, method: 'POST', body }),
      invalidatesTags: ['Wallet'],
    }),
  }),
});

export const {
  useWalletQuery,
  useWalletChargebacksQuery,
  useWalletTransactionsInfiniteQuery,
  useExchangeRatesQuery,
  useTopUpsInfiniteQuery,
  useTopUpQuery,
  useTopUpMethodsQuery,
  useCreateTopUpMutation,
  useSimulateTopUpMutation,
  useReservedAccountsQuery,
  useCreateReservedAccountsMutation,
  useSimulateDepositMutation,
} = resellerWalletApi;
