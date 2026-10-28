import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LegalArticle, LegalFrame } from "@/components/legal";
import { legalDocument, legalDocuments } from "@/lib/legal";

type Props = { params: Promise<{ doc: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return legalDocuments.map(doc => ({ doc: doc.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = legalDocument((await params).doc);
  if (!doc) return {};
  return { title: doc.title, description: doc.summary, alternates: { canonical: `/legal/${doc.slug}` } };
}

/** One of Afrippa's legal documents. */
export default async function LegalDocumentPage({ params }: Props) {
  const doc = legalDocument((await params).doc);
  if (!doc) notFound();
  return (
    <LegalFrame current={doc.slug}>
      <LegalArticle doc={doc} />
    </LegalFrame>
  );
}
