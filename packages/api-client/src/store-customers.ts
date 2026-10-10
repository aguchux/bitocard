/** A hosted store's customer, as the store's owner sees them (a reseller in SHQ, BitoCard in the admin app for bitocard.com). */
export type StoreCustomer = {
  object: 'store_customer';
  id: string;
  name: string;
  email: string;
  email_confirmed: boolean;
  /** `disabled` by the store's owner: cannot sign in or buy. */
  status: 'active' | 'disabled';
  /** Asked for the identity check where it applies (true), or turned off for them by the store's owner. */
  identity_check: boolean;
  /** Has passed BitoCard's identity check. Only the check itself sets this; nobody can mark it. */
  identity_checked: boolean;
  /** Paid purchases. */
  purchases: number;
  created_at: string;
};

/** One customer with their account state and latest purchases (never their codes). */
export type StoreCustomerDetail = Omit<StoreCustomer, 'object'> & {
  object: 'store_customer_detail';
  last_sign_in_at: string | null;
  /** Locked after too many wrong passwords until then; null when not locked. */
  locked_until: string | null;
  signed_in_sessions: number;
  disputes: number;
  /** Wallet balances (spend only, never withdrawn), per mode and currency. */
  wallet: Array<{ mode: 'live' | 'test'; currency: string; balance: number }>;
  purchases_list: Array<{
    id: string;
    order_id: string | null;
    status: 'paid' | 'completed' | 'refund_pending' | 'refunded';
    mode: 'test' | 'live';
    product: string | null;
    quantity: number;
    amount: number;
    currency: string;
    created_at: string;
  }>;
};

export type StoreCustomerFilter = { q?: string; limit?: number; starting_after?: string };
export type StoreCustomerUpdate = { identity_check?: boolean; status?: 'active' | 'disabled' };
