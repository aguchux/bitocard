import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/store/account-forms";
import { currentCustomer, safeNext } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const customer = await currentCustomer();
  if (!customer) redirect(`/signin?next=${encodeURIComponent(`/account/verify?next=${next}`)}`);
  if (customer.email_verified) redirect(next);
  return (
    <div className="mx-auto grid max-w-xl gap-5 py-6 sm:py-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-[#070f4c] sm:text-4xl">Confirm your email</h1>
        <p className="mt-2 text-slate-600">Enter the code we emailed you. You can browse in the meantime, but buying needs a confirmed email.</p>
      </div>
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <VerifyForm next={next} email={customer.email} />
      </section>
    </div>
  );
}
