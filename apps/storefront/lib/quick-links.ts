import type { StoreNavigationGroup, StoreTemplateKey } from "@bitocard/api-client/storefront";

/** The header's quick links (`quickLinks` in components/store/header-menus.tsx), by address. */
export const quickLinkHrefs = { numbers: "/catalogs/virtual_numbers", rdp: "/catalogs/rdp", vpn: "/catalogs/vpn", crypto: "/account/crypto", listings: "/listings" } as const;

/**
 * Which quick links a store's header shows: bitocard.com all of them; a reseller's store only what it sells (numbers,
 * RDP or VPN on sale there), Crypto only on a crypto desk, and Shop everything on a Resale shop.
 */
export function quickLinksFor(groups: StoreNavigationGroup[], template: StoreTemplateKey | null | undefined): string[] {
  if (!template) return [quickLinkHrefs.numbers, quickLinkHrefs.rdp, quickLinkHrefs.vpn, quickLinkHrefs.crypto];
  // A Resale shop's range is its listings.
  if (template === "resale_shop") return [quickLinkHrefs.listings];
  const onSale = (category: string) => groups.some(group => group.categories.some(item => item.category === category && item.on_sale));
  return [
    ...(onSale("virtual_numbers") ? [quickLinkHrefs.numbers] : []),
    ...(onSale("rdp") ? [quickLinkHrefs.rdp] : []),
    ...(onSale("vpn") ? [quickLinkHrefs.vpn] : []),
    ...(template === "crypto_desk" ? [quickLinkHrefs.crypto] : []),
  ];
}
