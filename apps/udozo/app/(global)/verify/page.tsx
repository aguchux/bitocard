import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileStartForm, VerifyForm } from "@/components/account-forms";
import { MobileConfirmForm } from "@/components/account/mobile-confirm";
import { countries } from "@/lib/countries";
import { channelsFor } from "@/lib/whatsapp";
import { confirmationPending, currentCustomer, safeNext, signInPath } from "@/lib/customer";

export const metadata: Metadata = { title: "Confirm your account", robots: { index: false, follow: false } };

/**
 * Accounts confirm their email here before chatting, buying or selling (and an older account its mobile, unless it puts
 * that off). A Google sign-up (its email confirmed by Google) onboards here in one step: its first and last name, its
 * country and its mobile, kept to confirm later from the profile.
 */
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  const customer = await currentCustomer();
  if (!customer) redirect(signInPath(next));
  if (!confirmationPending(customer)) redirect(next);
  const email = !customer.email_verified;
  if (!email && !customer.country) {
    const list = await countries();
    return (
      <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">Finish setting up</p>
        <h1 className="text-2xl font-extrabold">Welcome to Udozo, {customer.first_name}</h1>
        <p className="text-sm text-navy-600">Check your name, choose your country and add your mobile number. You buy and sell in your country&apos;s market, and your wallet is in its currency: it cannot be changed later.</p>
        <section className="rounded-3xl border border-navy-200 bg-white p-5">
          {list.length ? <ProfileStartForm next={next} firstName={customer.first_name} lastName={customer.last_name} markets={list} /> : <p className="text-sm text-navy-600">Your country could not be loaded just now. Try again shortly.</p>}
        </section>
      </div>
    );
  }
  const whatsapp = !email && (await channelsFor(customer.country)).whatsapp.available;
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-8">
      <h1 className="text-2xl font-extrabold">{email ? "Confirm your email" : "Confirm your mobile number"}</h1>
      <p className="text-sm text-navy-600">
        {email
          ? `We sent a 6-digit code to ${customer.email}. Enter it to carry on.`
          : customer.phone
            ? `We texted a 6-digit code to ${customer.phone}. Enter it to finish setting up your account.`
            : `Add your mobile number: we ${whatsapp ? "send" : "text"} it a 6-digit code to finish setting up your account.`}
      </p>
      <section className="rounded-3xl border border-navy-200 bg-white p-5">
        {email ? <VerifyForm next={next} email={customer.email} /> : <MobileConfirmForm next={next} phone={customer.phone} country={customer.country ?? ""} whatsapp={whatsapp} />}
      </section>
    </div>
  );
}
