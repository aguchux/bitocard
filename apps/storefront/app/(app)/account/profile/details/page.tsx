import type { Metadata } from "next";
import { Lock, Mail } from "lucide-react";
import { accountCard, AccountScreen } from "@/components/app/account-menu";
import { CountryForm, NameForm } from "@/components/store/account-forms";
import { Flag } from "@/components/store/flag";
import { ProfilePhoneForm } from "@/components/store/profile-phone-form";
import { markets } from "@/lib/countries";
import { currentCustomer } from "@/lib/customer";

export const metadata: Metadata = { title: "Profile" };

/**
 * Profile: name, sign-in email, verified mobile number and the customer's fixed buying country.
 */
export default async function DetailsPage() {
  const [customer, countries] = await Promise.all([currentCustomer().then(found => found!), markets()]);
  const country = countries.find(item => item.code === customer.country);
  return (
    <AccountScreen title="Profile" lead="Your name, email, verified phone number and the country you buy from.">
      <section aria-labelledby="details" className={accountCard}>
        <h2 id="details" className="mb-4 text-lg font-bold">
          Your details
        </h2>
        <div className="space-y-5">
          <NameForm name={customer.name} />
          <div className="border-t border-slate-100 pt-5">
            <p className="text-sm font-semibold text-navy-900">Email</p>
            <p className="mt-1.5 flex min-h-12 items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 text-[15px] text-slate-700 ring-1 ring-slate-200/70">
              <Mail className="size-4 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 truncate">{customer.email}</span>
            </p>
            <p className="mt-1.5 text-xs text-slate-500">You sign in with this email, and your codes are sent to it.</p>
          </div>
          <div className="border-t border-slate-100 pt-5">
            <ProfilePhoneForm key={customer.phone ?? 'none'} phone={customer.phone} verified={customer.phone_verified} country={customer.country} available={customer.phone_verification_available} />
          </div>
        </div>
      </section>

      <section id="country" aria-labelledby="country-heading" className={`scroll-mt-24 ${accountCard}`}>
        <h2 id="country-heading" className="mb-3 text-lg font-bold">
          Your country
        </h2>
        {customer.country ? (
          <div className="flex flex-wrap items-center gap-3">
            <Flag code={customer.country} className="h-6 w-9" />
            <p className="min-w-0 flex-1">
              <span className="block font-semibold">{country?.name ?? customer.country}</span>
              <span className="block text-sm text-slate-500">Your wallet, payments and prices are in {customer.currency ?? country?.currency ?? "its currency"}.</span>
            </p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              <Lock className="size-3.5" aria-hidden="true" /> Fixed
            </span>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-slate-600">Choose the country you buy from. Your wallet, payments and prices will be in its currency, and it cannot be changed later.</p>
            <CountryForm markets={countries} />
          </>
        )}
      </section>
    </AccountScreen>
  );
}
