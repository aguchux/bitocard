"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { subMenuFor, type SubMenuContext } from "./sub-menus";

/**
 * Phones and tablets: the tab's own places (Catalog's groups, Orders' filters, disputes and sold gift cards, the
 * wallets, Deposits and Transactions, Account's screens) as BitoCard's underlined tabs across the top of the page,
 * sliding sideways, the current one slid into view. The same menus as the desktop sub rail (`SubRail`), from
 * `subMenuFor`, so the two never differ; nothing shows where the page has no menu (Home).
 */
export function SubTabs({ context }: { context: SubMenuContext }) {
  const found = subMenuFor(usePathname(), useSearchParams(), context);
  if (!found) return null;
  const { menu, active } = found;
  return (
    <UnderlineTabs
      label={`${menu.label} menu`}
      className="-mt-5 mb-5 sm:-mt-8 sm:mb-6 lg:hidden"
      current={active}
      tabs={menu.items.map(({ href, label, icon, soon }) => ({ href, label, icon, soon }))}
    />
  );
}
