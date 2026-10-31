import { useResellerSettingsQuery } from "@bitocard/api-client/reseller";

/**
 * Whether Udozo charges sellers (the API's `paid_plans` switch, off at launch): only then does Seller HQ show plans,
 * Premium, its free domain and the setup fee. False while the settings load, so none of them flashes up.
 */
export function usePaidPlans() {
  return useResellerSettingsQuery().data?.features.paid_plans === true;
}

/** What the wallet pays Udozo for, in Seller HQ's words. */
export const walletPaysFor = (paidPlans: boolean) => (paidPlans ? "Premium, domains and the setup fee" : "domains");
