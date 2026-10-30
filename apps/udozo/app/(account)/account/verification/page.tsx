import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";
import { kycDeclineReasons } from "@bitocard/api-client/kyc";
import { VerificationForm } from "@/components/account-forms";
import { PageTitle } from "@/components/account/nav";
import { requireCustomer } from "@/lib/account";
import { countries } from "@/lib/countries";
import { customerApi } from "@/lib/customer";

export const metadata: Metadata = { title: "Identity check" };

type Status = { verified: boolean; latest: { status: string; reason: string | null; url: string | null } | null };

/** A declined check's reason in words (Verify's codes, and the older ones). */
const reasonText = (reason: string) =>
  kycDeclineReasons[reason as keyof typeof kycDeclineReasons] ?? ({ not_verified: "We could not confirm your identity", name_mismatch: "The name did not match", expired: "The check was not finished in time" } as Record<string, string>)[reason] ?? reason;

/**
 * The customer's identity check for their own country (Udozo Verify): needed once before a Safe pay seller is paid.
 * Its address is where Verify sends them back to. A check in progress opens with a fresh link, since links work once.
 */
export default async function VerificationPage() {
  const customer = await requireCustomer("/account/verification");
  const country = customer.country ?? "";
  const [list, status] = await Promise.all([countries(), country ? customerApi<Status>("GET", `/v1/store/account/verification?country=${encodeURIComponent(country)}`) : null]);
  const name = list.find(item => item.code === country)?.name ?? country;
  return (
    <div className="grid max-w-2xl gap-5">
      <PageTitle title="Identity check" note="Once, before you are paid for a Safe pay sale. It protects buyers and sellers from fraud." post={false} />
      <section className="rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
        {!country ? (
          <p className="text-sm text-navy-600">Choose your country in your profile first.</p>
        ) : status?.ok && status.data.verified ? (
          <p className="flex items-center gap-2 font-semibold text-mint-700">
            <ShieldCheck className="size-5" aria-hidden="true" /> You are verified for {name}.
          </p>
        ) : status?.ok && status.data.latest?.status === "in_review" ? (
          <p className="text-navy-700">Your check is being reviewed by a person. We will let you know by email.</p>
        ) : (
          <>
            {status?.ok && status.data.latest?.reason ? <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your last check did not pass: {reasonText(status.data.latest.reason)}.</p> : null}
            <VerificationForm country={country} countryName={name} resume={status?.ok && status.data.latest?.status === "in_progress"} />
          </>
        )}
      </section>
    </div>
  );
}
