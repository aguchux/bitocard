import type { StoreCryptoTransaction } from "@bitocard/api-client/storefront";

/** How far back the wallet page's recent activity looks, and how many it shows; the rest are on the activity screen. */
export const recentWindowMs = 24 * 60 * 60 * 1000;
export const recentLimit = 5;

/** The newest items from the last 24 hours (the list is newest first), at most `limit`. */
export function recentItems<T extends { created_at: string }>(items: T[], now = Date.now(), limit = recentLimit) {
  return items.filter(item => {
    const at = Date.parse(item.created_at);
    return Number.isFinite(at) && now - at <= recentWindowMs;
  }).slice(0, limit);
}

/** What moved in and out of the coins' spendable balance (an ad's lock shows once, as it leaves). */
export const cryptoMoves = (items: StoreCryptoTransaction[]) => items.filter(item => item.balance === "available");

/** The activity screen's lists: the money wallets, or the coins. */
export type ActivityShow = "money" | "crypto";
export const activityShow = (value: string | undefined): ActivityShow => (value === "crypto" ? "crypto" : "money");

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The page's cursor: the last item of the page before, only when it is an ID (anything else starts at the newest). */
export const activityCursor = (value: string | undefined) => (value && uuid.test(value) ? value : null);

/** The activity screen's address: the list shown and, for older pages, the cursor. */
export function activityHref(show: ActivityShow, after?: string | null) {
  const query = new URLSearchParams({ ...(show === "crypto" ? { show } : {}), ...(after ? { after } : {}) }).toString();
  return `/account/wallet/activity${query ? `?${query}` : ""}`;
}
