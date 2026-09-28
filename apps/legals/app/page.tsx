import Link from "next/link";
import { legalContact, legalDocuments, legalUpdated, legalUpdatedIso } from "@bitocard/ui/legal";
import { JsonLd, organizationId, organizationSchema } from "@bitocard/ui/seo";
import { appUrl } from "@bitocard/ui/site";
import { Commitments, ContactBand, RegionLinks, Section } from "@/components/blocks";
import { Icon } from "@/components/icons";
import { ogImagePath, siteName } from "@/components/seo";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

function homeSchema() {
  const home = appUrl("legals");
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationSchema(),
      { "@type": "WebSite", "@id": `${home}#website`, url: home, name: siteName, inLanguage: "en-GB", publisher: { "@id": organizationId() } },
      { "@type": "WebPage", "@id": home, url: home, name: "Legals & Compliance", inLanguage: "en-GB", dateModified: legalUpdatedIso, isPartOf: { "@id": `${home}#website` }, about: { "@id": organizationId() }, primaryImageOfPage: { "@type": "ImageObject", url: appUrl("legals", ogImagePath("/")), width: 1200, height: 630 }, significantLink: legalDocuments.map(doc => appUrl("legals", doc.href)).concat(appUrl("legals", "/contact")) },
    ],
  };
}

export default function LegalsHome() {
  return (
    <div className="lp">
      <JsonLd data={homeSchema()} />
      <div className="lp-top">
        <SiteHeader />
        <main className="lp-hero">
          <section className="lp-copy" aria-labelledby="headline">
            <p className="lp-status">Updated <time dateTime={legalUpdatedIso}>{legalUpdated}</time></p>
            <h1 id="headline">Plain-English legals.<br /><span>For every region.</span></h1>
            <p className="lp-lead">Privacy, terms, cookies and company details for BitoCard across Europe, the Americas, Africa and Asia, all in one place.</p>
            <div className="lp-actions">
              <Link className="lp-button lp-button-primary" href="/documents">Browse documents <span aria-hidden="true">→</span></Link>
              <Link className="lp-button" href="/contact">Contact us</Link>
            </div>
            <p className="lp-note">Accounts, payments and transactions are not yet live. These documents cover our websites today, and service terms will be published here before launch.</p>
          </section>

          <figure className="coverage" aria-labelledby="coverage-title">
            <div className="coverage-card">
              <div className="coverage-head">
                <span className="coverage-badge"><Icon name="shield" /></span>
                <div><p>Privacy notice</p><h2 id="coverage-title">Your rights, by region</h2></div>
              </div>
              <RegionLinks variant="card" />
            </div>
            <figcaption>Summary · Full details in the privacy notice</figcaption>
          </figure>
        </main>
      </div>

      <Section id="explore" title="Find what you need" lead="Everything that governs BitoCard’s websites, and the people to ask about it.">
        <ul className="signposts">
          <li className="signpost">
            <span className="doc-icon"><Icon name="document" /></span>
            <h3><Link href="/documents">Documents</Link></h3>
            <p>Read our privacy notice, terms of use, cookie notice and legal notice, and see your rights by region.</p>
            <ul className="signpost-links">
              {legalDocuments.map(doc => <li key={doc.href}><Link href={doc.href}>{doc.label}</Link></li>)}
            </ul>
          </li>
          <li className="signpost">
            <span className="doc-icon"><Icon name="mail" /></span>
            <h3><Link href="/contact">Contact</Link></h3>
            <p>Ask our legal team a question, make a privacy request, report a security issue, or find out who is responsible for you.</p>
            <ul className="signpost-links">
              <li><Link href="/contact#requests">Make a privacy request</Link></li>
              <li><Link href="/contact#responsible">Who is responsible</Link></li>
              <li><a href={`mailto:${legalContact}`}>{legalContact}</a></li>
            </ul>
          </li>
        </ul>
      </Section>

      <Section id="commitments" title="Our commitments">
        <Commitments />
      </Section>

      <ContactBand />
      <SiteFooter />
    </div>
  );
}
