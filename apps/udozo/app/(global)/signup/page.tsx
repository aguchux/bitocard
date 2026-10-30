import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthLinks, SignUpForm } from "@/components/account-forms";
import { markets } from "@/lib/api";
import { countries } from "@/lib/countries";
import { currentCustomer, safeNext } from "@/lib/customer";

export const metadata: Metadata = { title: "Create your account", robots: { index: false, follow: true }, alternates: { canonical: "/signup" } };

/**
 * A Udozo account: name, email, country (fixed for good: the market they buy and sell in, and their wallet's currency)
 * and a password, then the emailed code. The country Udozo's marketplace was opened from is chosen first.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string; country?: string }> }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await currentCustomer()) redirect(next);
  const [list, open] = await Promise.all([countries(), markets()]);
  const fromPath = /^\/([a-z]{2})(?:\/|$)/.exec(next)?.[1]?.toUpperCase();
  const suggested = [params.country?.toUpperCase(), fromPath, open.data.length === 1 ? open.data[0]!.country : undefined].find(code => code && list.some(item => item.code === code)) ?? null;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl leading-tight font-extrabold">Create your Udozo account</h1>
      <p className="text-sm text-navy-600">Buy and sell near you, and pay safely with Safe pay. One account works on udozo.com and every Udozo store.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        {list.length ? (
          <SignUpForm next={next} markets={list} market={suggested} />
        ) : (
          <p role="alert" className="text-sm text-navy-600">
            Sign-up is not available just now. Try again shortly.
          </p>
        )}
        <AuthLinks next={next} page="signup" />
      </section>
    </div>
  );
}
