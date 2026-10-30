import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { CountryForm, NameForm, PasswordForm } from "@/components/account-forms";
import { PageTitle } from "@/components/account/nav";
import { PhoneForm } from "@/components/account/phone-form";
import { Flag } from "@/components/flag";
import { requireCustomer } from "@/lib/account";
import { signOut } from "@/lib/account-actions";
import { countries } from "@/lib/countries";

export const metadata: Metadata = { title: "Profile" };

const card = "grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5";

/**
 * The customer's profile: their name, the email they sign in with (read only), their country (fixed: chosen once by an
 * older account that has none), their mobile number (from that country, confirmed by a texted code), the password and
 * signing out. The identity check, for Safe pay sellers, is its own page.
 */
export default async function ProfilePage() {
  const customer = await requireCustomer("/account/profile");
  const list = await countries();
  const country = list.find(item => item.code === customer.country);
  return (
    <div className="grid max-w-2xl gap-5">
      <PageTitle title="Profile" post={false} />
      <section aria-labelledby="you" className={card}>
        <h2 id="you" className="font-bold">
          You
        </h2>
        <NameForm name={customer.name} />
        <p className="text-sm text-navy-600">
          You sign in with <strong className="text-navy-900">{customer.email}</strong>.
        </p>
      </section>
      <section id="country" aria-labelledby="country-title" className={card}>
        <h2 id="country-title" className="font-bold">
          Your country
        </h2>
        {customer.country ? (
          <p className="flex items-center gap-2 text-[15px]">
            <Flag country={customer.country} /> <strong>{country?.name ?? customer.country}</strong>
            {customer.currency ? <span className="text-navy-500">· {customer.currency}</span> : null}
          </p>
        ) : list.length ? (
          <CountryForm markets={list} />
        ) : (
          <p className="text-sm text-navy-600">Your country could not be loaded just now. Try again shortly.</p>
        )}
        <p className="text-xs text-navy-500">You buy and sell in its market; your wallet and payouts are in its currency. It cannot be changed.</p>
      </section>
      <section aria-label="Phone number" className={card}>
        <PhoneForm phone={customer.phone} verified={customer.phone_verified} country={customer.country} available={customer.phone_verification_available} />
      </section>
      <section aria-labelledby="check" className={card}>
        <h2 id="check" className="font-bold">
          Identity check
        </h2>
        <p className="text-sm text-navy-600">Needed once before you are paid for a Safe pay sale.</p>
        <Link href="/account/verification" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-300">
          <ShieldCheck className="size-4" aria-hidden="true" /> Your identity check
        </Link>
      </section>
      <section aria-labelledby="password" className={card}>
        <h2 id="password" className="font-bold">
          Password
        </h2>
        <PasswordForm />
      </section>
      <form action={signOut}>
        <button type="submit" className="min-h-11 rounded-xl px-1 font-semibold text-brand-700 hover:underline">
          Sign out
        </button>
      </form>
    </div>
  );
}
