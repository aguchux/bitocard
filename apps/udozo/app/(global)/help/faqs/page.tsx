import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { faqGroups } from "@/lib/help";

import { JsonLd } from "@/components/json-ld";
import { faqJsonLd } from "@/lib/seo";

export const metadata: Metadata = {
  title: "FAQs",
  description: "Answers about buying and selling on Udozo, Safe pay, calls and contact requests, reselling on Seller HQ, and your account.",
  alternates: { canonical: "/help/faqs" },
};

/** The FAQs: a section per topic, each question opening its answer, then Contact us for anything else. */
export default function FaqsPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 pt-5 pb-10">
      <JsonLd data={faqJsonLd(faqGroups)} />
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-navy-600">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span>Help</span>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span aria-current="page" className="font-semibold text-brand-700">
          FAQs
        </span>
      </nav>
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">Frequently asked questions</h1>
        <p className="text-navy-600">Quick answers about buying, selling and staying safe on Udozo.</p>
      </header>
      <nav aria-label="Topics" className="flex flex-wrap gap-2">
        {faqGroups.map(group => (
          <a key={group.id} href={`#${group.id}`} className="rounded-full border border-navy-200 bg-white px-3.5 py-1.5 text-sm font-semibold text-navy-900 hover:border-navy-300">
            {group.title}
          </a>
        ))}
      </nav>
      {faqGroups.map(group => (
        <section key={group.id} id={group.id} aria-labelledby={`${group.id}-heading`} className="grid scroll-mt-28 gap-2">
          <h2 id={`${group.id}-heading`} className="text-lg font-bold text-navy-900">
            {group.title}
          </h2>
          <div className="divide-y divide-navy-100 rounded-2xl border border-navy-100 bg-white">
            {group.faqs.map(faq => (
              <details key={faq.q} className="group px-4 sm:px-5">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
                  {faq.q}
                  <ChevronDown className="size-5 shrink-0 text-navy-500 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <p className="pb-4 text-[15px] leading-relaxed text-navy-700">{faq.a}</p>
              </details>
            ))}
          </div>
        </section>
      ))}
      <section className="grid gap-2 rounded-2xl bg-navy-900 p-5 text-white sm:p-6">
        <h2 className="text-lg font-bold">Still need help?</h2>
        <p className="text-navy-100">Write to our support team and we will reply by email.</p>
        <Link href="/help/contact" className="mt-1 inline-flex min-h-11 w-fit items-center rounded-xl bg-brand-500 px-4 font-bold hover:bg-brand-600">
          Contact us
        </Link>
      </section>
    </div>
  );
}
