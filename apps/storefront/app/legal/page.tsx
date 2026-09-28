import type { Metadata } from "next";
import Link from "next/link";
import { legalDocuments } from "@bitocard/ui/legal";
import { ContactEmail, EntityTable, LegalPage, Section } from "@/components/legal";

export const metadata: Metadata = {
  title: "Legal | BitoCard",
  description: "BitoCard's privacy notice, terms of use, cookie notice and legal notice.",
  alternates: { canonical: "/legal" },
};

const summaries: Record<string, string> = {
  "/legal/privacy": "What personal information this website handles, why, and your rights in Europe, the Americas, Africa and Asia.",
  "/legal/terms": "The rules for using this coming-soon website.",
  "/legal/cookies": "Our use of cookies and similar technologies. We set none today.",
  "/legal/notice": "The companies behind BitoCard and how to contact them.",
};

export default function LegalIndex() {
  return (
    <LegalPage
      title="Legal"
      intro={<p>BitoCard is coming soon. Accounts, payments and transactions are not yet available, so these documents cover this information website only. We will publish further terms before any service launches.</p>}
    >
      <Section id="documents" title="Our documents">
        <ul className="legal-docs">
          {legalDocuments.map(doc => (
            <li key={doc.href}><Link href={doc.href}>{doc.label}</Link><p>{summaries[doc.href]}</p></li>
          ))}
        </ul>
      </Section>
      <Section id="who" title="Who is responsible">
        <p>BitoCard is operated by companies in the Golojan group. The company responsible for you depends on where you are.</p>
        <EntityTable caption="Golojan entity by region" />
        <p>If your region is not listed, Golojan Technologies LLC is responsible.</p>
      </Section>
      <Section id="contact" title="Contact">
        <p>For any legal or privacy matter, email <ContactEmail />.</p>
      </Section>
    </LegalPage>
  );
}
