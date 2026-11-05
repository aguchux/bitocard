import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { anjioMethod } from "@/lib/scores";

export const metadata: Metadata = {
  title: "How Anjio rates sellers",
  description: "What Udozo's seller scores measure, what buyers see, what sellers see, and how Anjio writes its short summary of each seller.",
  alternates: { canonical: "/help/how-anjio-rates-sellers" },
};

/** How the seller scores are worked out, in plain words: what each measures, its minimum, and who sees what. */
export default function HowAnjioRatesPage() {
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
          How Anjio rates sellers
        </span>
      </nav>
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">How Anjio rates sellers</h1>
        <p className="text-navy-600">{anjioMethod.intro}</p>
      </header>
      <section aria-labelledby="measures" className="grid gap-3">
        <h2 id="measures" className="text-lg font-bold text-navy-900">
          What is measured
        </h2>
        <ul className="grid gap-3">
          {anjioMethod.measures.map(item => (
            <li key={item.key} className="grid gap-1 rounded-2xl border border-navy-200 bg-white p-4">
              <strong className="text-navy-900">{item.title}</strong>
              <span className="text-sm text-navy-700">{item.how}</span>
              <span className="text-xs text-navy-600">{item.who}</span>
            </li>
          ))}
        </ul>
      </section>
      {anjioMethod.sections.map(section => (
        <section key={section.title} className="grid gap-2">
          <h2 className="text-lg font-bold text-navy-900">{section.title}</h2>
          {section.body.map(line => (
            <p key={line} className="text-sm text-navy-700">
              {line}
            </p>
          ))}
        </section>
      ))}
      <p className="text-sm text-navy-700">
        Think a score or summary about you is wrong? Report it from your account&apos;s Reviews, or{" "}
        <Link href="/help/contact" className="font-semibold text-brand-700 hover:underline">
          contact us
        </Link>
        .
      </p>
    </div>
  );
}
