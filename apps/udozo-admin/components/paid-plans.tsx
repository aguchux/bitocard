"use client";

import { Notice } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { useSwitchesQuery } from "@bitocard/api-client/admin";

/** Whether Udozo charges sellers: the global `paid_plans` switch, else its default (off). Null while it loads. */
export function usePaidPlansSwitch() {
  const switches = useSwitchesQuery();
  if (!switches.data) return null;
  const row = switches.data.data.find(item => item.key === "paid_plans" && item.scope === "global");
  return row?.enabled ?? switches.data.definitions.paid_plans?.default ?? false;
}

/**
 * On the Plans and Setup fees pages while paid plans are off: what sellers see (nothing of either) and where to start
 * charging. Plans and fees set here wait until then.
 */
export function PaidPlansNotice() {
  const on = usePaidPlansSwitch();
  if (on !== false) return null;
  return (
    <Notice tone="amber" title="Paid plans are off">
      Sellers see no plans and no setup fee, and every store has every feature. What you set here waits until you switch on{" "}
      <AppLink href="/settings" className="font-semibold text-brand-600 hover:underline">
        Paid plans
      </AppLink>{" "}
      in Settings &gt; Feature switches.
    </Notice>
  );
}
