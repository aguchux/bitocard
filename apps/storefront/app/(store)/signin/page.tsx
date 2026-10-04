import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Store, UserRound } from "lucide-react";
import { appUrl } from "@bitocard/ui/site";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to BitoCard.",
  alternates: { canonical: "/signin" },
  robots: { index: false, follow: true },
};

/**
 * Sign in. Customer accounts come with checkout (M10b); until then this page says so and sends resellers to SHQ,
 * where every reseller signs in.
 */
export default function SignInPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-5 py-6 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Sign in</h1>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-pink-50 text-[#ff2382]">
          <UserRound className="size-6" aria-hidden="true" />
        </span>
        <h2 className="font-display mt-4 text-xl font-bold text-[#070f4c]">Customer accounts are coming soon</h2>
        <p className="mt-2 text-slate-600">You will sign in here to buy, see your orders and get your codes again. Until then you can browse everything on sale.</p>
        <Link href="/catalogs" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 font-semibold text-[#070f4c] hover:border-slate-300">
          Browse the catalogue <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </section>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-[#2477ff]">
          <Store className="size-6" aria-hidden="true" />
        </span>
        <h2 className="font-display mt-4 text-xl font-bold text-[#070f4c]">Are you a reseller?</h2>
        <p className="mt-2 text-slate-600">Resellers sign in to SHQ, BitoCard&apos;s Seller Head Quarters, to run their store, wallet and orders.</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a href={appUrl("shq", "/signin")} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#ff2382] px-4 font-semibold text-white hover:bg-[#e8116d]">
            Reseller sign in <ArrowRight className="size-4" aria-hidden="true" />
          </a>
          <Link href="/resellers" className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 font-semibold text-[#070f4c] hover:border-slate-300">
            Open a reseller store
          </Link>
        </div>
      </section>
    </div>
  );
}
