import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplyWizard } from "@/components/apply-wizard";
import { Notice } from "@/components/notice";
import { openStates } from "@/lib/areas";
import { accountProblem, type Application, type ApplySettings, firstStep, isEditable } from "@/lib/connect";
import { currentCustomer, customerApi } from "@/lib/session";
import { signInPath, udozoOrigin, udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Apply" };

/**
 * Applying: what applying needs in the person's market, then the wizard for a new application or the one they are
 * still filling in (or changing, when Udozo asked). An application already sent is followed on `/application`.
 */
export default async function ApplyPage() {
  if (!(await currentCustomer())) redirect(signInPath("/apply"));
  const settings = await customerApi<ApplySettings>("GET", "/v1/connect/apply");
  if (!settings.ok) {
    if (settings.status === 401) redirect(signInPath("/apply"));
    const problem = accountProblem(settings.code);
    return <Notice title="We could not open your application" body={problem ?? settings.message} action={problem ? { href: udozoUrl("/account/profile"), label: "Go to udozo.com" } : undefined} />;
  }

  let application: Application | null = null;
  if (settings.data.application_id) {
    const current = await customerApi<Application>("GET", `/v1/connect/applications/${settings.data.application_id}`);
    if (current.ok) application = current.data;
    if (application && !isEditable(application.status)) redirect("/application");
  }
  if (!settings.data.open && !application) {
    return <Notice title="Not open in your country yet" body="Connect Centre applications are not open in your country yet. Check back soon." />;
  }

  const states = await openStates(settings.data.country, settings.data.states);
  return <ApplyWizard settings={settings.data} states={states} application={application} initialStep={firstStep(application)} udozo={udozoOrigin()} />;
}
