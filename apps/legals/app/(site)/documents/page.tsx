import { legalDocuments, legalUpdated, legalUpdatedIso } from "@bitocard/ui/legal";
import { JsonLd, organizationId } from "@bitocard/ui/seo";
import { appUrl } from "@bitocard/ui/site";
import { ContactBand, DocumentCards, PageHero, RegionLinks, Section } from "@/components/blocks";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { breadcrumbSchema, pageMetadata } from "@/components/seo";

const seo = { title: "Documents", description: "Every BitoCard legal document in one place: privacy notice, terms of use, cookie notice and legal notice, with your privacy rights by region.", path: "/documents" };

export const metadata = pageMetadata(seo);

export default function DocumentsPage() {
  const url = appUrl("legals", seo.path);
  return (
    <>
      <JsonLd data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "CollectionPage", "@id": url, url, name: seo.title, description: seo.description, inLanguage: "en-GB", dateModified: legalUpdatedIso,
            isPartOf: { "@id": `${appUrl("legals")}#website` }, publisher: { "@id": organizationId() }, breadcrumb: { "@id": `${url}#breadcrumb` },
            hasPart: legalDocuments.map(doc => ({ "@type": "WebPage", "@id": appUrl("legals", doc.href), name: doc.label })),
          },
          breadcrumbSchema(seo),
        ],
      }} />
      <div className="page-inner">
        <Breadcrumbs trail={[{ href: "/", label: "Home" }]} current="Documents" />
        <PageHero
          eyebrow={<>Updated <time dateTime={legalUpdatedIso}>{legalUpdated}</time></>}
          title="Every document."
          accent="One place."
          lead="The documents that govern BitoCard’s websites, written in plain English and kept up to date for every region we serve."
        />
      </div>

      <Section id="documents" title="Our documents">
        <DocumentCards />
      </Section>

      <Section id="rights" title="Your privacy rights, by region" lead="Jump straight to the part of our privacy notice that applies where you live.">
        <RegionLinks />
      </Section>

      <Section id="coming-next" title="Coming next">
        <div className="next-note">
          <p>Before BitoCard launches accounts, payments or transactions, we will publish the terms that govern them here, such as reseller and customer agreements, and update the notices above. Nothing here yet offers or governs a live service.</p>
        </div>
      </Section>

      <ContactBand />
    </>
  );
}
