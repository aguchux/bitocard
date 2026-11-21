import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { legalContact, registeredCompany, supportContact } from "@/lib/legal";

export const metadata: Metadata = {
  title: "About us",
  description: `Udozo is a marketplace for buying and selling near you, owned and operated by ${registeredCompany.name} (${registeredCompany.number}), a company registered in Nigeria.`,
  alternates: { canonical: "/about" },
};

/** About us (Get help > About us): what Udozo is and who owns it, by the company's registered name and number. */
export default function AboutPage() {
  const rows: [string, string][] = [
    ["Registered name", registeredCompany.name],
    ["Registration number", registeredCompany.number],
    ["Registered in", "Nigeria (Corporate Affairs Commission)"],
    ["Incorporated", registeredCompany.incorporated],
  ];
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 pt-5 pb-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-navy-600">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span>Help</span>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span aria-current="page" className="font-semibold text-brand-700">
          About us
        </span>
      </nav>
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">About Udozo</h1>
        <p className="text-navy-600">Udozo is a marketplace for buying and selling near you. UdozoPay holds the money until the buyer has the item.</p>
      </header>
      <section aria-labelledby="owner-heading" className="grid gap-3 rounded-2xl border border-navy-100 bg-white p-5 sm:p-6">
        <h2 id="owner-heading" className="text-lg font-bold text-navy-900">
          Who owns Udozo
        </h2>
        <p className="text-[15px] leading-relaxed text-navy-700">
          Udozo, its name, brand, websites and apps are owned and operated by <strong className="text-navy-900">{registeredCompany.name}</strong>, a company
          registered in Nigeria, part of the Golojan group of businesses (
          <a href="https://golojan.com" target="_blank" rel="noopener" className="font-semibold text-brand-700 hover:underline">
            golojan.com
          </a>
          ).
        </p>
        <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-[auto_1fr]">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-navy-500">{term}</dt>
              <dd className="font-semibold text-navy-900">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="contact-heading" className="grid gap-2 rounded-2xl bg-navy-900 p-5 text-white sm:p-6">
        <h2 id="contact-heading" className="text-lg font-bold">
          Get in touch
        </h2>
        <p className="text-navy-100">
          Help with an account, a listing or an order: <a href={`mailto:${supportContact}`} className="font-semibold underline">{supportContact}</a>. Legal and privacy
          requests: <a href={`mailto:${legalContact}`} className="font-semibold underline">{legalContact}</a>.
        </p>
        <Link href="/help/contact" className="mt-1 inline-flex min-h-11 w-fit items-center rounded-xl bg-brand-500 px-4 font-bold hover:bg-brand-600">
          Contact us
        </Link>
      </section>
    </div>
  );
}
