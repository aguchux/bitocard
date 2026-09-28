import { legalDocuments, legalUpdated, legalUpdatedIso } from "@bitocard/ui/legal";
import { JsonLd, organizationId } from "@bitocard/ui/seo";
import { appUrl } from "@bitocard/ui/site";
import { ContactBand, DocumentCards, PageBanner, RegionLinks, Section } from "@/components/blocks";
import { breadcrumbSchema, pageMetadata, webPageFields } from "@/components/seo";

const seo = { title: "Documents", description: "Every BitoCard legal document in one place: privacy notice, terms of use, cookie notice and legal notice, with your privacy rights by region.", path: "/documents" };

export const metadata = pageMetadata(seo);

export default function DocumentsPage() {
  return (
    <>
      <JsonLd data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "CollectionPage", ...webPageFields(seo), about: { "@id": organizationId() },
            mainEntity: { "@type": "ItemList", itemListElement: legalDocuments.map((doc, index) => ({ "@type": "ListItem", position: index + 1, url: appUrl("legals", doc.href), name: doc.label })) },
            hasPart: legalDocuments.map(doc => ({ "@type": "WebPage", "@id": appUrl("legals", doc.href), name: doc.label })),
          },
          breadcrumbSchema(seo),
        ],
      }} />
      <PageBanner
        trail={[{ href: "/", label: "Home" }]}
        current="Documents"
        eyebrow={<>Updated <time dateTime={legalUpdatedIso}>{legalUpdated}</time></>}
        title="Every document."
        accent="One place."
        lead="The documents that govern BitoCard’s websites, written in plain English and kept up to date for every region we serve."
      />

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
