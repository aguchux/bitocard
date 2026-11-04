import type { Metadata } from "next";
import type { DiscoveryHistory } from "@bitocard/api-client/discovery";
import { PageTitle } from "@/components/account/nav";
import { PrivacyControls } from "@/components/account/privacy-controls";
import { requireCustomer } from "@/lib/account";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Privacy" };

/**
 * The customer's say over personalised discovery: whether what they look at shapes what Udozo shows them, what is
 * remembered (Recently viewed, Recent searches, each removable) and Clear my history.
 */
export default async function PrivacyPage() {
  const customer = await requireCustomer("/account/privacy");
  const history = await customerApi<DiscoveryHistory>("GET", "/v1/classifieds/history");
  const personalisation = history.ok ? history.data.personalisation : (customer.personalisation ?? true);
  return (
    <div className="grid max-w-2xl gap-5">
      <PageTitle title="Privacy" note="What Udozo remembers to show you what you are likely to want, and your say over it." post={false} />
      {history.ok ? null : <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your history could not be loaded just now. Try again shortly.</p>}
      <PrivacyControls personalisation={personalisation} history={history.ok ? history.data : null} />
    </div>
  );
}
