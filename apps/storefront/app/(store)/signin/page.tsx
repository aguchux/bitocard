import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Store } from "lucide-react";
import { appUrl } from "@bitocard/ui/site";
import { SignInForm } from "@/components/store/account-forms";
import { currentCustomer, safeNext } from "@/lib/customer";
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
  return (
    <div className="mx-auto grid max-w-3xl gap-5 py-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Sign in</h1>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <SignInForm next={next} />
        <p className="mt-6 text-sm text-slate-600">
          New here?{" "}
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-[#2477ff] hover:underline">
            Create an account
          </Link>
        </p>
      </section>
      {resellerStore ? null : (
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-[#2477ff]">
          <Store className="size-6" aria-hidden="true" />
        </span>
        <h2 className="font-display mt-4 text-xl font-bold text-[#070f4c]">Are you a reseller?</h2>
        <p className="mt-2 text-slate-600">Resellers sign in to SHQ, BitoCard&apos;s Seller Head Quarters, to run their store, wallet and orders.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={appUrl("shq", "/signin")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#070f4c] px-4 font-semibold text-white hover:bg-[#0d1a6e]">
            Reseller sign in <ArrowRight className="size-4" aria-hidden="true" />
          </a>
          <Link href="/resellers" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold text-[#070f4c] hover:border-slate-300">
            Open a reseller store
          </Link>
        </div>
      </section>
      )}
    </div>
  );
}
