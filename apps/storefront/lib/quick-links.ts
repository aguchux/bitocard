import type { StoreNavigationGroup, StoreTemplateKey } from "@bitocard/api-client/storefront";

/** The header's quick links (`quickLinks` in components/store/header-menus.tsx), by address. */
export const quickLinkHrefs = { rdp: "/catalogs/rdp", vpn: "/catalogs/vpn" } as const;

/**
 * Which quick links a store's header shows: bitocard.com all of them; a reseller's store only what it sells (RDP or VPN
 * on sale there).
 */
export function quickLinksFor(groups: StoreNavigationGroup[], template: StoreTemplateKey | null | undefined): string[] {
  if (!template) return [quickLinkHrefs.rdp, quickLinkHrefs.vpn];
  const onSale = (category: string) => groups.some(group => group.categories.some(item => item.category === category && item.on_sale));
  return [
    ...(onSale("rdp") ? [quickLinkHrefs.rdp] : []),
    ...(onSale("vpn") ? [quickLinkHrefs.vpn] : []),
  ];
}
