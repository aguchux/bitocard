import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApplicationView } from "@/components/application-view";
import { Notice } from "@/components/notice";
import { accountProblem, type Application } from "@/lib/connect";
import { currentCustomer, customerApi } from "@/lib/session";
import { signInPath, udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Your application" };

/**
 * The person's latest Connect Centre application, followed step by step (udozo.com's notice links,
 * `/connect/application`, come here). None yet: on to applying.
 */
export default async function ApplicationPage() {
  if (!(await currentCustomer())) redirect(signInPath("/application"));
  const list = await customerApi<{ data: Application[] }>("GET", "/v1/connect/applications");
  if (!list.ok) {
    if (list.status === 401) redirect(signInPath("/application"));
    const problem = accountProblem(list.code);
    return <Notice title="We could not open your application" body={problem ?? list.message} action={problem ? { href: udozoUrl("/account/profile"), label: "Go to udozo.com" } : undefined} />;
  }
  const latest = list.data.data[0];
  if (!latest) redirect("/apply");
  return <ApplicationView key={latest.updated_at} application={latest} />;
}
