/** A hosted store's customer, as the store's owner sees them (a reseller in SHQ, BitoCard in the admin app for bitocard.com). */
export type StoreCustomer = {
  object: 'store_customer';
  id: string;
  name: string;
  email: string;
  email_confirmed: boolean;
  /** Asked for the identity check where it applies (true), or turned off for them by the store's owner. */
  identity_check: boolean;
  /** Has passed BitoCard's identity check. Only the check itself sets this; nobody can mark it. */
  identity_checked: boolean;
  /** Paid purchases. */
  purchases: number;
  created_at: string;
};

export type StoreCustomerFilter = { q?: string; limit?: number; starting_after?: string };
