import "server-only";
import { redirect } from "next/navigation";
import { type Customer, currentCustomer, signInPath } from "@/lib/customer";

/** The signed-in customer, their email confirmed; else signing in (or confirming the email) first, back to `next`. */
export async function requireCustomer(next: string): Promise<Customer> {
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(next, "trade"));
  if (!customer.email_verified) redirect(`/verify?next=${encodeURIComponent(next)}`);
  return customer;
}

/**
 * Money in and out of BitoCard wallets stays on the customer's account app for now (their country store): adding money,
 * depositing and withdrawing coins, cashing out, and the identity check. `/go/<place>` takes them there, signed in.
 */
export const accountPlaces = {
  wallet: "/account/wallet",
  deposit: "/account/crypto/deposit",
  withdraw: "/account/crypto/withdraw",
  "cash-out": "/account/crypto/cash-out",
  verification: "/account/verification",
} as const;

export type AccountPlace = keyof typeof accountPlaces;

/** The coins a customer can trade now (crypto on for them), in order. */
export const tradableAssets = (overview: { enabled: boolean; assets: Array<{ asset: string; enabled: boolean }> } | null) =>
  overview?.enabled ? overview.assets.filter(item => item.enabled).map(item => item.asset) : [];
