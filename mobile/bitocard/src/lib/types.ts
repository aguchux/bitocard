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

export type Wallet = {
  object: 'customer_wallet';
  country: string;
  currency: string;
  /** Wallets are on: purchases are paid only from the wallet. */
  enabled: boolean;
  balance: number;
  wallets: { currency: string; primary: boolean; balance: number; removable: boolean }[];
};

export type AccountSummary = {
  object: 'customer_summary';
  orders_total: { amount: number; currency: string }[];
  orders: { total: number; in_progress: number };
  delivered_this_month: number;
};
