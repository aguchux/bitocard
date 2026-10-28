import "server-only";
import { redirect } from "next/navigation";
import type { MoneyLinks } from "@bitocard/crypto-ui/money-views";
import { type Customer, currentCustomer, signInPath } from "@/lib/customer";

/** The signed-in customer, their email confirmed; else signing in (or confirming the email) first, back to `next`. */
export async function requireCustomer(next: string): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(next, "trade"));
  if (!customer.email_verified) redirect(`/verify?next=${encodeURIComponent(next)}`);
  return customer;
}

/**
 * What stays on the customer's account app (their country store): the identity check, and choosing the country of an
 * older account. `/go/<place>` takes them there, signed in. Money in and out is on this site.
 */
export const accountPlaces = {
  verification: "/account/verification",
  profile: "/account/profile/details#country",
} as const;

const chosen = (asset: string, chain?: string) => `?${new URLSearchParams({ asset, ...(chain ? { chain } : {}) })}`;

/** This site's money pages, for the shared deposit and withdrawal views (`@bitocard/crypto-ui`). */
export const moneyLinks: MoneyLinks = {
  deposit: (asset, chain) => `/deposit${chosen(asset, chain)}`,
  withdraw: (asset, chain) => `/withdraw${chosen(asset, chain)}`,
  withdrawal: id => `/withdrawals/${id}`,
  verification: "/go/verification",
};

export type AccountPlace = keyof typeof accountPlaces;

/** The coins a customer can trade now (crypto on for them), in order. */
export const tradableAssets = (overview: { enabled: boolean; assets: Array<{ asset: string; enabled: boolean }> } | null) =>
  overview?.enabled ? overview.assets.filter(item => item.enabled).map(item => item.asset) : [];
