import type { Metadata } from "next";
import Link from "next/link";
import { DraftNotice, legalDate, LegalFrame } from "@/components/legal";
import { legalContact, legalDocuments, legalVersion, operator } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Legal",
  description: "Afrippa's terms of use, P2P trading rules, fees, risk warnings, privacy notice and cookie notice.",
  alternates: { canonical: "/legal" },
};

/** Afrippa's legal documents, each with what it covers. */
export default function LegalPage() {
  return (
    <LegalFrame current={null}>
      <header className="space-y-2">
        <h1 className="font-display text-3xl font-extrabold text-navy-900 sm:text-4xl">Legal</h1>
        <p className="text-slate-600">
          How Afrippa works, what it charges, what can go wrong and how your data is used. Version {legalVersion}, last updated {legalDate}.
        </p>
      </header>
      <DraftNotice />
      <ul className="grid gap-3 sm:grid-cols-2">
        {legalDocuments.map(doc => (
          <li key={doc.slug}>
            <Link href={`/legal/${doc.slug}`} className="block h-full rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 hover:ring-slate-300">
              <span className="font-semibold text-navy-900">{doc.title}</span>
              <span className="mt-1 block text-sm text-slate-600">{doc.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">
        Questions: <a href={`mailto:${legalContact}`} className="font-semibold text-brand-700 underline underline-offset-2">{legalContact}</a> or Help. The drafts name {operator.name} ({operator.number}) as Afrippa&apos;s operator until it is confirmed.
      </p>
    </LegalFrame>
  );
}
