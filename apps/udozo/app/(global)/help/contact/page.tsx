import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, CircleHelp, Mail, MessageCircle, Phone, ShieldCheck } from "lucide-react";
import { ContactForm } from "@/components/help/contact-form";
import { markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";
import { supportEmail, supportPhone, supportWhatsApp } from "@/lib/help";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Write to Udozo's support team about an order, Safe pay, your account, selling or reselling. We reply by email.",
  alternates: { canonical: "/help/contact" },
};

/**
 * Contact us: the form to Udozo's support team (worked in Udozo's admin, Support > Contact us), and beside it the other
 * ways to get help: email, WhatsApp, a phone line, Safe pay and the FAQs. A signed-in customer's name and email start filled in.
 */
export default async function ContactPage() {
  const [customer, all] = await Promise.all([currentCustomer(), markets()]);
  const country = customer?.country ?? (all.data.length === 1 ? all.data[0]!.country : null);
  const card = "rounded-2xl border border-navy-100 bg-white p-5 sm:p-6";
  return (
    <div className="bg-navy-50/40 pb-10">
      <div className="mx-auto grid max-w-6xl gap-5 px-4 pt-5 sm:px-6">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-navy-600">
          <Link href="/" className="hover:underline">
            Home
          </Link>
          <ChevronRight className="size-4" aria-hidden="true" />
          <Link href="/help/faqs" className="hover:underline">
            Help
          </Link>
          <ChevronRight className="size-4" aria-hidden="true" />
          <span aria-current="page" className="font-semibold text-brand-700">
            Contact us
          </span>
        </nav>
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">Contact us</h1>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section aria-labelledby="contact-form-heading" className={card}>
            <h2 id="contact-form-heading" className="text-lg font-bold text-navy-900">
              Have a question?
            </h2>
            <p className="mb-5 text-sm text-navy-600">Our support team reads every message and replies by email.</p>
            <ContactForm initial={{ name: customer?.name ?? "", email: customer?.email ?? "", phone: "" }} country={country} />
          </section>
          <aside className="grid gap-5">
            <div className={`${card} grid gap-5`}>
              <div className="flex gap-3">
                <Mail className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden="true" />
                <div>
                  <h2 className="font-bold text-navy-900">Email</h2>
                  <p className="text-sm text-navy-600">
                    Write to{" "}
                    <a href={`mailto:${supportEmail}`} className="font-semibold text-navy-900 hover:underline">
                      {supportEmail}
                    </a>
                    . We usually reply within one working day.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <MessageCircle className="mt-0.5 size-6 shrink-0 text-mint-700" aria-hidden="true" />
                <div>
                  <h2 className="font-bold text-navy-900">WhatsApp</h2>
                  <p className="text-sm text-navy-600">
                    Message us on{" "}
                    <a href={supportWhatsApp.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-navy-900 hover:underline">
                      {supportWhatsApp.shown}
                    </a>
                    . Messages only: this number takes no calls.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Phone className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden="true" />
                <div>
                  <h2 className="font-bold text-navy-900">Call us</h2>
                  <p className="text-sm text-navy-600">
                    Call{" "}
                    <a href={supportPhone.href} className="font-semibold text-navy-900 hover:underline">
                      {supportPhone.shown}
                    </a>
                    . It is a UK number, so calls from abroad cost international rates.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-6 shrink-0 text-mint-700" aria-hidden="true" />
                <div>
                  <h2 className="font-bold text-navy-900">A problem with a Safe pay order?</h2>
                  <p className="text-sm text-navy-600">
                    Open a dispute from the order itself, before you confirm you received it: it reaches our team fastest.{" "}
                    <Link href="/safe-trade#safe-pay" className="font-semibold text-navy-900 hover:underline">
                      How Safe pay works
                    </Link>
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <CircleHelp className="mt-0.5 size-6 shrink-0 text-brand-700" aria-hidden="true" />
                <div>
                  <h2 className="font-bold text-navy-900">Quick answers</h2>
                  <p className="text-sm text-navy-600">
                    Buying, selling, Safe pay and your account:{" "}
                    <Link href="/help/faqs" className="font-semibold text-navy-900 hover:underline">
                      read the FAQs
                    </Link>
                    .
                  </p>
                </div>
              </div>
            </div>
            <p className="rounded-2xl bg-white px-5 py-4 text-sm text-navy-600 ring-1 ring-navy-100">Udozo will never ask for your password, a code we texted or emailed you, or a Safe pay release code.</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
