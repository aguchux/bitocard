import type { StoreNavigationGroup, StoreTemplateKey } from "@bitocard/api-client/storefront";

/** The header's quick links (`quickLinks` in components/store/header-menus.tsx), by address. */
export const quickLinkHrefs = { numbers: "/catalogs/virtual_numbers", cards: "/catalogs/virtual_cards", crypto: "/account/crypto" } as const;

/**
 * Which quick links a store's header shows: bitocard.com all of them; a reseller's store only what it sells (numbers
 * or virtual cards on sale there) and Crypto only on a crypto desk.
 */
export function quickLinksFor(groups: StoreNavigationGroup[], template: StoreTemplateKey | null | undefined): string[] {
  if (!template) return Object.values(quickLinkHrefs);
  const onSale = (category: string) => groups.some(group => group.categories.some(item => item.category === category && item.on_sale));
  return [...(onSale("virtual_numbers") ? [quickLinkHrefs.numbers] : []), ...(onSale("virtual_cards") ? [quickLinkHrefs.cards] : []), ...(template === "crypto_desk" ? [quickLinkHrefs.crypto] : [])];
}
