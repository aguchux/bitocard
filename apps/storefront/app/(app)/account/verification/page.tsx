import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { kycDeclineReasons } from "@bitocard/api-client/kyc";
import { accountCard, AccountScreen } from "@/components/app/account-menu";
import { VerificationForm } from "@/components/store/account-forms";
import { currentCustomer, customerApi } from "@/lib/customer";
import { currentMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";

export const metadata: Metadata = { title: "Identity check", robots: { index: false, follow: false } };

/** `provider`: BitoCard Verify (verify.bitocard.com, African markets) or the identity partner elsewhere. */
type Status = { verified: boolean; provider?: "bitocard" | "didit"; latest: { status: string; reason: string | null; url: string | null } | null };

/** A declined check's reason in words (BitoCard Verify's codes, and the older ones). */
const reasonText = (reason: string) =>
  kycDeclineReasons[reason as keyof typeof kycDeclineReasons] ?? ({ not_verified: "We could not confirm your identity", name_mismatch: "The name did not match", expired: "The check was not finished in time" } as Record<string, string>)[reason] ?? reason;

/**
 * The customer's identity check for their country: needed once before buying some products in some countries. One of
 * the Account screens (pills on top), keeping its own address, which checkout and the identity partners return to.
 */
export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  if (!(await currentCustomer())) redirect("/signin?next=/account/verification");
  const [{ countries }, market, asked] = await Promise.all([storeNavigation(), currentMarket(), searchParams]);
  const country = (asked.country ?? (market && market !== "global" ? market : "")).toUpperCase();
  const name = countries.find(item => item.code === country)?.name ?? country;
  const status = country ? await customerApi<Status>("GET", `/v1/store/account/verification?country=${encodeURIComponent(country)}`) : null;

  return (
    <AccountScreen title="Identity check" lead="Some products, such as gift cards in some countries, need a one-time identity check before you can buy them. It protects you and us from fraud.">
      <section className={accountCard}>
        {!country ? (
          <form className="space-y-3">
            <label htmlFor="country" className="block text-sm font-semibold">
              Which country are you buying from?
            </label>
            <select id="country" name="country" required className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3">
              {countries.map(item => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </select>
            <button type="submit" className="inline-flex min-h-12 items-center rounded-xl bg-navy-900 px-5 font-semibold text-white">
              Continue
            </button>
          </form>
        ) : status?.ok && status.data.verified ? (
          <p className="flex items-center gap-2 font-semibold text-emerald-800">
            <ShieldCheck className="size-5" aria-hidden="true" /> You are verified for {name}.
          </p>
        ) : status?.ok && status.data.latest?.status === "in_review" ? (
          <p className="text-slate-700">Your check is being reviewed by a person. We will let you know by email.</p>
        ) : status?.ok && status.data.latest?.status === "in_progress" && status.data.latest.url ? (
          <a href={status.data.latest.url} className="inline-flex min-h-12 items-center rounded-xl bg-brand-500 px-5 font-semibold text-white">
            Continue your check
          </a>
        ) : (
          <>
            {status?.ok && status.data.latest?.reason ? <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your last check did not pass: {reasonText(status.data.latest.reason)}.</p> : null}
            <VerificationForm country={country} countryName={name} provider={status?.ok ? status.data.provider : undefined} />
          </>
        )}
      </section>
    </AccountScreen>
  );
}
