import "server-only";
import { redirect } from "next/navigation";
import type { MoneyLinks } from "@afrippa/ui/money-views";
import { currentSession, nextStep, signInPath, type Trader } from "@/lib/customer";

/** The signed-in trader (email confirmed, two-step finished); else signing in (or finishing those) first, back to `next`. */
export async function requireCustomer(next: string): Promise<Trader> {
  const session = await currentSession();
  if (!session) redirect(signInPath(next, "trade"));
  const step = nextStep(session, next);
  if (step !== next) redirect(step);
  return session;
}

const chosen = (asset: string, chain?: string) => `?${new URLSearchParams({ asset, ...(chain ? { chain } : {}) })}`;

/** This site's money pages, for the shared deposit and withdrawal views (`@afrippa/ui`). */
export const moneyLinks: MoneyLinks = {
  deposit: (asset, chain) => `/deposit${chosen(asset, chain)}`,
  withdraw: (asset, chain) => `/withdraw${chosen(asset, chain)}`,
  withdrawal: id => `/withdrawals/${id}`,
  verification: "/verification",
};

/** The coins a trader can trade now (crypto on for them), in order. */
export const tradableAssets = (overview: { enabled: boolean; assets: Array<{ asset: string; enabled: boolean }> } | null) =>
  overview?.enabled ? overview.assets.filter(item => item.enabled).map(item => item.asset) : [];
