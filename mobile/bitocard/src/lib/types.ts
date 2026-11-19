/** What BitoCard's API answers, as the app reads it (`apps/api`'s presenters). Only the fields the app uses. */

export type Customer = {
  object: 'customer';
  id: string;
  email: string;
  name: string;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  /** Fixed at sign-up: the wallet, checkouts and prices are in its currency. Null for older accounts until chosen. */
  country: string | null;
  currency: string | null;
  created_at: string;
};

/** Sign-in and sign-up answer the account and a session the app keeps in the secure store. */
export type SessionReply = { customer: Customer; session: { token: string; expires_at: string } };

export type Market = { code: string; name: string; currency: string };

export type PaymentMethod = { object: 'payment_method'; id: string; label: string; description: string; networks: string[] };

export type ReservedAccount = { object: 'reserved_account'; id: string; currency: string; bank_name: string; account_number: string; account_name: string };

export type Wallet = {
  object: 'customer_wallet';
  mode: 'live' | 'test';
  country: string;
  currency: string;
  /** Wallets are on: purchases are paid only from the wallet. */
  enabled: boolean;
  balance: number;
  top_up_methods: PaymentMethod[];
  reserved_accounts: ReservedAccount[];
  reserved_accounts_available: boolean;
  /** Nigeria: the bank needs the BVN to open an account number (passed on, never kept). */
  reserved_account_needs_bvn: boolean;
  wallets: { currency: string; primary: boolean; balance: number; removable: boolean }[];
};

export type WalletTransaction = {
  object: 'wallet_transaction';
  id: string;
  type: string;
  description: string;
  /** Positive: money in; negative: money out. */
  amount: number;
  currency: string;
  checkout_id: string | null;
  top_up_id: string | null;
  created_at: string;
};

export type TopUp = {
  object: 'customer_top_up';
  id: string;
  mode: 'live' | 'test';
  status: 'pending' | 'succeeded' | 'failed';
  amount: number;
  currency: string;
  method: { id: string; label: string };
  checkout_url: string | null;
  failure_reason: string | null;
};

export type Conversion = {
  object: 'wallet_conversion';
  id: string | null;
  from: { amount: number; currency: string };
  to: { amount: number; currency: string };
  rate: string;
};

export type BankDepositOptions = {
  object: 'bank_deposit_options';
  currency: string;
  available: boolean;
  accounts: { id: string; bank_name: string; account_name: string; account_number: string; details: string | null }[];
  min_amount: number;
  window_hours: number;
};

export type BankDeposit = {
  object: 'bank_deposit';
  id: string;
  number: string;
  mode: 'live' | 'test';
  status: 'awaiting_payment' | 'sent' | 'credited' | 'rejected' | 'cancelled' | 'expired';
  currency: string;
  amount: number;
  credited_amount: number | null;
  reference: string;
  account: { bank_name: string; account_name: string; account_number: string; details: string | null };
  decision_note: string | null;
  expires_at: string;
};

export type StoreBrand = { slug: string; name: string; logo_url: string | null; color: string | null; initials: string };

export type StoreProduct = {
  object: 'store_product';
  id: string;
  key: string;
  name: string;
  category: string;
  country: string;
  face_currency: string;
  denomination_type: 'fixed' | 'range';
  from: number;
  to: number;
  logo_url: string | null;
  brand: StoreBrand;
};

export type StoreProductDetail = StoreProduct & {
  /** Fixed face values, or the range a customer may enter (minor units of `face_currency`). */
  denominations: number[] | null;
  range: { min: number; max: number } | null;
  recipient_type: string | null;
};

export type NetworkDetection = { object: 'network_detection'; detected: boolean; brand?: string; product: StoreProduct | null };

export type CheckoutPreview = {
  object: 'checkout_preview';
  quote_id: string;
  amount: number;
  currency: string;
  tax: { name: string; amount: number } | null;
  expires_at: string;
  wallet_balance: number;
  wallet_options: { currency: string; amount: number; balance: number; enough: boolean }[];
};

export type CheckoutStatus = 'awaiting_payment' | 'paid' | 'completed' | 'failed' | 'refund_pending' | 'refunded';

export type Checkout = {
  object: 'checkout';
  id: string;
  mode: 'live' | 'test';
  status: CheckoutStatus;
  product: { id: string; key: string; name: string; category: string; brand: string };
  face_value: number;
  face_currency: string;
  quantity: number;
  amount: number;
  currency: string;
  charged: { amount: number; currency: string } | null;
  method: { id: string; label: string };
  /** The gateway's payment page while it waits to be paid (never for wallet payments). */
  checkout_url: string | null;
  recipient: { phone?: string; email?: string; account_number?: string } | null;
  order: { id: string; status: string; receipt_number: string | null; completed_at: string | null } | null;
  failure_reason: string | null;
  refunded_at: string | null;
  created_at: string;
};

export type Page<T> = { object: 'list'; data: T[]; has_more: boolean };

export type AccountSummary = {
  object: 'customer_summary';
  orders_total: { amount: number; currency: string }[];
  orders: { total: number; in_progress: number };
  delivered_this_month: number;
};
