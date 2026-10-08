import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { VerificationForm } from "@/components/store/account-forms";
import { currentCustomer, customerApi } from "@/lib/customer";
import { currentMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";

export const metadata: Metadata = { title: "Identity check", robots: { index: false, follow: false } };

type Status = { verified: boolean; latest: { status: string; reason: string | null; url: string | null } | null };

/** The customer's identity check for their country: needed once before buying some products in some countries. */
export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  if (!(await currentCustomer())) redirect("/signin?next=/account/verification");
  const [{ countries }, market, asked] = await Promise.all([storeNavigation(), currentMarket(), searchParams]);
  const country = (asked.country ?? (market && market !== "global" ? market : "")).toUpperCase();
  const name = countries.find(item => item.code === country)?.name ?? country;
  const status = country ? await customerApi<Status>("GET", `/v1/store/account/verification?country=${encodeURIComponent(country)}`) : null;

  return (
    <div className="mx-auto grid max-w-xl gap-5">
      <Link href="/account/profile" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-slate-600 hover:text-[#070f4c]">
        <ChevronLeft className="size-4" aria-hidden="true" /> Your account
      </Link>
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c]">Identity check</h1>
      <p className="text-slate-600">Some products, such as gift cards in some countries, need a one-time identity check before you can buy them. It protects you and us from fraud.</p>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
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
            <button type="submit" className="inline-flex min-h-12 items-center rounded-xl bg-[#070f4c] px-5 font-semibold text-white">
              Continue
            </button>
          </form>
        ) : status?.ok && status.data.verified ? (
          <p className="flex items-center gap-2 font-semibold text-emerald-800">
            <ShieldCheck className="size-5" aria-hidden="true" /> You are verified for {name}.
          </p>
        ) : status?.ok && status.data.latest?.status === "in_review" ? (
          <p className="text-slate-700">Your check is being reviewed. We will let you know by email.</p>
        ) : status?.ok && status.data.latest?.status === "in_progress" && status.data.latest.url ? (
          <a href={status.data.latest.url} className="inline-flex min-h-12 items-center rounded-xl bg-[#ff2382] px-5 font-semibold text-white">
            Continue your check
          </a>
        ) : (
          <>
            {status?.ok && status.data.latest?.reason ? <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your last check did not pass: {status.data.latest.reason}</p> : null}
            <VerificationForm country={country} countryName={name} />
          </>
        )}
      </section>
    </div>
  );
}
