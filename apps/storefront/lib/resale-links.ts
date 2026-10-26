/** Addresses on a Resale shop (B2B reselling): a listing's page and its supplier's page. Pure, for pages and tests. */

export const resaleListingPath = (item: { ref: number; slug: string }) => `/l/${item.ref}-${item.slug}`;

/** The supplier's page on this store; with a listing, it shows that listing exactly as they wrote it. */
export const resaleSupplierPath = (supplierId: string, ref?: number) => `/suppliers/${supplierId}${ref ? `?listing=${ref}` : ""}`;

/** The listing number from `/l/<ref>-<slug>`, or null. */
export function listingRef(param: string) {
  const match = /^(\d{1,15})(?:-[a-z0-9-]*)?$/.exec(param);
  return match ? Number(match[1]) : null;
}

const conditionLabels: Record<string, string> = { new: "New", used: "Used", untested: "Untested", parts: "For parts" };
export const resaleCondition = (condition: string | null) => (condition ? (conditionLabels[condition] ?? condition) : null);

export const deliveryText = (delivery: "none" | "state" | "nationwide", area: { name: string; state: string | null } | null) =>
  delivery === "nationwide" ? "Delivery nationwide" : delivery === "state" ? `Delivery within ${area?.state ?? "the state"}` : `Meet-up in ${area?.name ?? "the supplier’s area"}`;