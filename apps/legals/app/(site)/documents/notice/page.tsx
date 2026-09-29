import { brand } from "@bitocard/ui/site";
import { legalEntities } from "@bitocard/ui/legal";
import { ContactEmail, LegalPage, Section } from "@/components/legal";
import { pageMetadata } from "@/components/seo";

const seo = { title: "Legal notice", description: "The Golojan group companies that operate BitoCard, where they are registered, and how to contact our legal team.", path: "/documents/notice" };

export const metadata = pageMetadata(seo);

export default function LegalNotice() {
  return (
    <LegalPage
      seo={seo}
      intro={<p>{brand.name} is operated by the following companies in the Golojan group.</p>}
    >
      <Section id="operators" title="Website operators">
        <div className="legal-entities">
          {legalEntities.map(entity => (
            <section key={entity.name} aria-label={entity.name}>
              <h3>{entity.name}</h3>
              <dl>
                <dt>Registered in</dt><dd>{entity.jurisdiction}</dd>
                {entity.companyNumber ? <><dt>{entity.companyNumberLabel ?? "Company number"}</dt><dd>{entity.companyNumber}</dd></> : null}
                {entity.registeredAddress ? <><dt>Registered address</dt><dd>{entity.registeredAddress}</dd></> : null}
                <dt>Responsible for</dt><dd>{entity.regions}</dd>
              </dl>
            </section>
          ))}
        </div>
      </Section>

      <Section id="contact" title="Contact">
        <p>Email: <ContactEmail /></p>
      </Section>

      <Section id="content" title="Content">
        <p>BitoCard is coming soon. The content of these websites is for information only and does not offer any product or service. Planned features, markets and availability may change.</p>
      </Section>

      <Section id="marks" title="Trade marks">
        <p>BitoCard and the BitoCard logo are brands of the Golojan group. Other names and brands mentioned belong to their respective owners.</p>
      </Section>
    </LegalPage>
  );
}
