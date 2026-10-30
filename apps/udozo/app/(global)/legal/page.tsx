import type { Metadata } from "next";
import Link from "next/link";
import { DraftNotice, legalDate, LegalFrame } from "@/components/legal";
import { legalContact, legalDocuments, legalVersion, operator, supportContact } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Legal",
  description: "Udozo's terms of use, Safe pay rules, seller terms, privacy notice and cookie notice.",
  alternates: { canonical: "/legal" },
};

/** Udozo's legal documents, each with what it covers. */
export default function LegalPage() {
  return (
    <LegalFrame current={null}>
      <header className="grid gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Legal</h1>
        <p className="text-navy-600">
          How Udozo works, how Safe pay holds your money, the terms for sellers, and how your data is used. Version {legalVersion}, last updated {legalDate}.
        </p>
      </header>
      <DraftNotice />
      <ul className="grid gap-3 sm:grid-cols-2">
        {legalDocuments.map(doc => (
          <li key={doc.slug}>
            <Link href={`/legal/${doc.slug}`} className="block h-full rounded-2xl border border-navy-200 bg-white p-4 hover:border-navy-400">
              <span className="font-semibold text-navy-900">{doc.title}</span>
              <span className="mt-1 block text-sm text-navy-600">{doc.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-navy-600">
        Udozo is owned and operated by {operator.name} ({operator.number}). Help:{" "}
        <a href={`mailto:${supportContact}`} className="font-semibold text-brand-700 underline underline-offset-2">
          {supportContact}
        </a>
        ; legal and privacy requests:{" "}
        <a href={`mailto:${legalContact}`} className="font-semibold text-brand-700 underline underline-offset-2">
          {legalContact}
        </a>
        .
      </p>
    </LegalFrame>
  );
}
