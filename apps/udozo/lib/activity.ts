/** How far back the wallet page's recent transactions look, and how many it shows; the rest are on the Transactions screen. */
export const recentWindowMs = 24 * 60 * 60 * 1000;
export const recentLimit = 5;

/** The newest items from the last 24 hours (the list is newest first), at most `limit`. */
export function recentItems<T extends { created_at: string }>(items: T[], now = Date.now(), limit = recentLimit) {
  return items.filter(item => {
    const at = Date.parse(item.created_at);
    return Number.isFinite(at) && now - at <= recentWindowMs;
  }).slice(0, limit);
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The page's cursor: the last item of the page before, only when it is an ID (anything else starts at the newest). */
export const activityCursor = (value: string | undefined) => (value && uuid.test(value) ? value : null);

/** The Transactions screen's address and, for older pages, the cursor. */
export function activityHref(after?: string | null) {
  return `/account/wallet/transactions${after ? `?${new URLSearchParams({ after })}` : ""}`;
}
