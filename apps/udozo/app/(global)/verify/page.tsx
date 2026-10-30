import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/account-forms";
import { currentCustomer, safeNext, signInPath } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false, follow: false } };

/** Accounts that have not confirmed their email yet do it here before chatting, buying or selling. */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(next));
  if (customer.email_verified) redirect(next);
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold">Confirm your email</h1>
      <p className="text-sm text-navy-600">We sent a 6-digit code to {customer.email}. Enter it to carry on.</p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        <VerifyForm next={next} email={customer.email} />
      </section>
    </div>
  );
}
