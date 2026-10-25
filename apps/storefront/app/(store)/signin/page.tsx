import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ChevronRight, Store } from "lucide-react";
import { firstName, handoffStart } from "@bitocard/ui/handoff";
import { appUrl } from "@bitocard/ui/site";
import { SignInForm } from "@/components/store/account-forms";
import { currentCustomer, safeNext, siteOrigin } from "@/lib/customer";
import { signedInElsewhere } from "@/lib/handoff";
import { onResellerStore } from "@/lib/store";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your account to buy and see your orders.",
  alternates: { canonical: "/signin" },
  robots: { index: false, follow: true },
};

/** Customers sign in here to buy and see their orders; resellers are sent to SHQ, where they sign in. */
export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  const resellerStore = await onResellerStore();
  const elsewhere = await signedInElsewhere();
  const continueHref = elsewhere ? handoffStart(elsewhere.origin, await siteOrigin(), next) : null;
  return (
    <div className="mx-auto grid max-w-3xl gap-5 py-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">Sign in</h1>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        {resellerStore ? null : <p className="mb-5 text-slate-600">Use the same BitoCard account you buy gift cards and airtime with.</p>}
        {elsewhere ? (
          <>
            {/* Signed in on another BitoCard site: one click, through a one-time code from that site. */}
            <a href={continueHref!} className="flex items-center gap-3 rounded-2xl border-2 border-navy-900 p-3.5 text-navy-900 hover:bg-slate-50">
              <span className="grid size-11 shrink-0 place-items-center rounded-full bg-navy-900 font-bold text-white" aria-hidden="true">
                {firstName(elsewhere.name).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <strong className="block">Continue as {elsewhere.name}</strong>
                <span className="block text-sm text-slate-600">Signed in on {elsewhere.host}</span>
              </span>
              <ChevronRight className="size-5 shrink-0" aria-hidden="true" />
            </a>
            <p className="my-5 flex items-center gap-3 text-sm text-slate-500">
              <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
              or sign in
              <span className="h-px flex-1 bg-slate-200" aria-hidden="true" />
            </p>
          </>
        ) : null}
        <SignInForm next={next} />
        <p className="mt-6 text-sm text-slate-600">
          New here?{" "}
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-azure-500 hover:underline">
            Create an account
          </Link>
        </p>
      </section>
      {resellerStore ? null : (
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-azure-500">
          <Store className="size-6" aria-hidden="true" />
        </span>
        <h2 className="font-display mt-4 text-xl font-bold text-navy-900">Are you a reseller?</h2>
        <p className="mt-2 text-slate-600">Resellers sign in to SHQ, BitoCard&apos;s Seller Head Quarters, to run their store, wallet and orders.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={appUrl("shq", "/signin")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-navy-900 px-4 font-semibold text-white hover:bg-navy-800">
            Reseller sign in <ArrowRight className="size-4" aria-hidden="true" />
          </a>
          <Link href="/resellers" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold text-navy-900 hover:border-slate-300">
            Open a reseller store
          </Link>
        </div>
      </section>
      )}
    </div>
  );
}
