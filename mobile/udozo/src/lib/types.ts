/**
 * What the app reads that is not in the shared types (`@shared/classifieds`, `@shared/home`): the customer's account and
 * its sign-in answers, markets and countries, notifications. As udozo.com reads them (`apps/udozo/lib/customer.ts`).
 */

export type Customer = {
  object: 'customer';
  id: string;
  email: string;
  name: string;
  first_name: string;
  last_name: string | null;
  name_confirmed: boolean;
  email_verified: boolean;
  phone: string | null;
  phone_verified: boolean;
  phone_verification_available: boolean;
  phone_deferred?: boolean;
  country: string | null;
  currency: string | null;
  avatar_url?: string | null;
  username?: string | null;
  seller_handle?: string | null;
  created_at: string;
};

export type SessionReply = { customer: Customer; session: { token: string }; signed_up?: boolean };

/** A country customers can sign up in (`GET /v1/countries`). */
export type Country = { code: string; name: string; currency: string; signup?: boolean };

export type Notice = {
  object: 'notification';
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  severity: 'info' | 'success' | 'warning' | 'critical';
  read_at: string | null;
  created_at: string;
};
export type Notices = { object: 'list'; data: Notice[]; has_more: boolean; unread_count: number };

/**
 * Still to do before the account can be used, as udozo.com asks it: the emailed code; for a Google, Apple or Facebook
 * sign-up, its name and country; then the mobile, unless the customer chose to confirm it later.
 */
export const confirmationPending = (customer: Pick<Customer, 'email_verified' | 'phone_verified' | 'phone_verification_available' | 'country'> & { phone_deferred?: boolean }) =>
  !customer.email_verified || !customer.country || (customer.phone_verification_available && !customer.phone_verified && !customer.phone_deferred);
