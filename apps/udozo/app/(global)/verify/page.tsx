import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VerifyForm } from "@/components/account-forms";
import { MobileConfirmForm } from "@/components/account/mobile-confirm";
import { confirmationPending, currentCustomer, safeNext, signInPath } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm your account", robots: { index: false, follow: false } };

/**
 * Accounts confirm their email, then their mobile number (texted a code at sign-up, where the country can text), here
 * before chatting, buying or selling.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(next));
  if (!confirmationPending(customer)) redirect(next);
  const email = !customer.email_verified;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Step {email ? 1 : 2} of 2</p>
      <h1 className="text-2xl font-extrabold">{email ? "Confirm your email" : "Confirm your mobile number"}</h1>
      <p className="text-sm text-navy-600">
        {email
          ? `We sent a 6-digit code to ${customer.email}. Enter it to carry on.`
          : customer.phone
            ? `We texted a 6-digit code to ${customer.phone}. Enter it to finish setting up your account.`
            : "Add your mobile number: we text it a 6-digit code to finish setting up your account."}
      </p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        {email ? <VerifyForm next={next} email={customer.email} /> : <MobileConfirmForm next={next} phone={customer.phone} country={customer.country ?? ""} />}
      </section>
    </div>
  );
}
