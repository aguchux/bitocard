"use client";

import { usePathname } from "next/navigation";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { accountSections, activeAccountSection } from "./account-sections";

/**
 * The account screens as underlined tabs (BitoCard's standard tabs): the current one on a pink line, the rest on the
 * grey one, each with its icon and the screens not built yet marked Soon. On phones and tablets the row slides
 * sideways to the screen's edges and opens with the current screen in view.
 */
export function AccountPills() {
  const key = activeAccountSection(usePathname());
  const active = accountSections.find(section => section.key === key);
  return (
    <UnderlineTabs
      label="Account settings"
      tabs={accountSections.map(({ href, label, icon, soon }) => ({ href, label, icon, soon }))}
      current={active?.href ?? null}
    />
  );
}
