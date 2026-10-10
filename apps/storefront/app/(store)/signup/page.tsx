import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/store/account-forms";
import { markets } from "@/lib/countries";
import { currentCustomer, safeNext } from "@/lib/customer";
import { currentMarket } from "@/lib/market";
import { currentStore } from "@/lib/store";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a free account to buy gift cards, top-ups and more.",
  alternates: { canonical: "/signup" },
  robots: { index: false, follow: true },
};

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  if (await currentCustomer()) redirect(next);
  // bitocard.com asks for the customer's country (the shopper's market first); a reseller's store is theirs.
  const [{ store }, market] = await Promise.all([currentStore(), currentMarket()]);
  const countries = store ? [] : await markets();
  return (
    <div className="mx-auto grid max-w-xl gap-5 py-6 sm:py-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Create an account</h1>
        <p className="mt-2 text-slate-600">Free. Your codes, receipts and orders stay in your account.</p>
      </div>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <SignUpForm next={next} markets={countries} market={market} />
        <p className="mt-6 text-sm text-slate-600">
          Already have an account?{" "}
          <Link href={`/signin?next=${encodeURIComponent(next)}`} className="font-semibold text-[#2477ff] hover:underline">
            Sign in
          </Link>
        </p>
      </section>
      <p className="text-xs text-slate-500">
        By creating an account you agree to BitoCard&apos;s terms (BitoCard sells and delivers every order), and we use your details as the privacy notice explains. Your account is with this store only.
      </p>
    </div>
  );
}
