import type { Metadata } from "next";
import Link from "next/link";
import { AtSign, Eye, MessageCircle, ShieldCheck } from "lucide-react";
import { regionWord } from "@bitocard/api-client/classifieds";
import { CountryForm, NameForm, PasswordForm } from "@/components/account-forms";
import { AboutForm } from "@/components/account/about-form";
import { AvatarForm } from "@/components/account/avatar-form";
import { PageTitle } from "@/components/account/nav";
import { PhoneForm } from "@/components/account/phone-form";
import { Flag } from "@/components/flag";
import { requireCustomer, sellReference } from "@/lib/account";
import { usernameScreen } from "@/lib/username";
import { channelsFor, whatsappScreen } from "@/lib/whatsapp";
import { signOut } from "@/lib/account-actions";
import { countries } from "@/lib/countries";

export const metadata: Metadata = { title: "Profile" };

const card = "grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5";

/**
 * The customer's profile: their first and last name (an older account is asked to confirm how its old name was
 * split), the email they sign in with (read only), their country (fixed: chosen once by an
 * older account that has none), about them (where they live, their date of birth and sex), their mobile number (from
 * that country, confirmed by a texted code), the password and signing out. Their username has its own page, linked here. The identity check, for Safe pay sellers, and
 * Privacy (personalisation and history) are their own pages.
 */
export default async function ProfilePage() {
  const customer = await requireCustomer("/account/profile");
  const [list, reference, channels] = await Promise.all([countries(), customer.country ? sellReference(customer.country) : null, channelsFor(customer.country)]);
  const country = list.find(item => item.code === customer.country);
  return (
    <div className="grid max-w-2xl gap-5">
      <PageTitle title="Profile" post={false} />
      <section aria-labelledby="photo" className={card}>
        <h2 id="photo" className="font-bold">
          Profile photo
        </h2>
        <AvatarForm name={customer.name} url={customer.avatar_url ?? null} />
      </section>
      <section aria-labelledby="you" className={card}>
        <h2 id="you" className="font-bold">
          You
        </h2>
        {customer.name_confirmed ? null : (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            Check your first and last name, as on your ID. We split the name you gave us before, so it may need putting right.
          </p>
        )}
        <NameForm firstName={customer.first_name} lastName={customer.last_name} confirm={!customer.name_confirmed} />
        <p className="text-sm text-navy-600">
          You sign in with <strong className="text-navy-900">{customer.email}</strong>.
        </p>
      </section>
      <section id="username" aria-labelledby="username-title" className={card}>
        <h2 id="username-title" className="font-bold">
          Username
        </h2>
        <p className="text-sm text-navy-600">
          {customer.username ? (
            <>
              Your seller page is at your username, <strong className="break-all text-navy-900">{customer.username}</strong>.
            </>
          ) : (
            "Choose a username and your seller page's address becomes your name, once you have posted enough ads."
          )}
        </p>
        <Link href={usernameScreen} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-300">
          <AtSign className="size-4" aria-hidden="true" /> {customer.username ? "Your username" : "Choose a username"}
        </Link>
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
      {customer.country && reference?.states.length ? (
        <section id="about" aria-labelledby="about-title" className={card}>
          <h2 id="about-title" className="font-bold">
            About you
          </h2>
          <AboutForm states={reference.states} region={regionWord(customer.country)} areaId={customer.area_id ?? null} birthDate={customer.birth_date ?? null} sex={customer.sex ?? null} />
        </section>
      ) : null}
      <section id="phone" aria-label="Phone number" className={card}>
        <PhoneForm phone={customer.phone} verified={customer.phone_verified} country={customer.country} available={customer.phone_verification_available} whatsapp={Boolean(channels.whatsapp.codes)} />
      </section>
      {channels.whatsapp.available ? (
        <section id="whatsapp" aria-labelledby="whatsapp-title" className={card}>
          <h2 id="whatsapp-title" className="font-bold">
            WhatsApp
          </h2>
          <p className="text-sm text-navy-600">Find, sell, chat and ask for what you need from WhatsApp, through Udozo&apos;s number.</p>
          <Link href={whatsappScreen} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-300">
            <MessageCircle className="size-4" aria-hidden="true" /> WhatsApp
          </Link>
        </section>
      ) : null}
      <section aria-labelledby="check" className={card}>
        <h2 id="check" className="font-bold">
          Identity check
        </h2>
        <p className="text-sm text-navy-600">Needed once before you are paid for a Safe pay sale.</p>
        <Link href="/account/verification" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-300">
          <ShieldCheck className="size-4" aria-hidden="true" /> Your identity check
        </Link>
      </section>
      <section aria-labelledby="privacy" className={card}>
        <h2 id="privacy" className="font-bold">
          Privacy
        </h2>
        <p className="text-sm text-navy-600">Personalise what you see, and what Udozo remembers: listings you viewed and your searches.</p>
        <Link href="/account/privacy" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-navy-200 px-4 font-semibold hover:border-navy-300">
          <Eye className="size-4" aria-hidden="true" /> Privacy and your history
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
