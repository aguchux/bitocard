import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "@bitocard/ui/brand-lockup";
import { legalContact, legalDocuments, legalEntities, legalUpdated } from "@bitocard/ui/legal";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = { alternates: { canonical: "/" } };

type IconName = "shield" | "document" | "cookie" | "building" | "globe" | "mail" | "ban" | "scale" | "clock";
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
    document: <><path d="M6 2h9l4 4v16H6zM14 2v5h5" /><path d="M9 12h7M9 16h7" /></>,
    cookie: <><path d="M21 12a9 9 0 1 1-9-9 3 3 0 0 0 4 4 3 3 0 0 0 5 5Z" /><circle cx="9" cy="10" r="1" /><circle cx="14" cy="15" r="1" /><circle cx="9" cy="15" r="1" /></>,
    building: <><path d="M4 21V5l8-3 8 3v16M2 21h20" /><path d="M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
    ban: <><circle cx="12" cy="12" r="9" /><path d="m6 6 12 12" /></>,
    scale: <><path d="M12 3v18M5 21h14M4 8h16M7 8l-3 7a3 3 0 0 0 6 0Zm10 0-3 7a3 3 0 0 0 6 0Z" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const documentDetails: Record<string, { icon: IconName; summary: string }> = {
  "/privacy": { icon: "shield", summary: "What our websites collect, why, who we share it with, and your rights in each region." },
  "/terms": { icon: "document", summary: "The rules for using our coming-soon websites, and the law that applies where you are." },
  "/cookies": { icon: "cookie", summary: "We set no cookies today. How we will ask first if that ever changes." },
  "/notice": { icon: "building", summary: "The Golojan group companies behind BitoCard and how to reach them." },
};

// Anchors match the region headings in the privacy notice.
const regions = [
  { name: "Europe", laws: "UK GDPR · EU GDPR · Swiss FADP", anchor: "europe", tone: "pink" },
  { name: "United States", laws: "CCPA/CPRA · state privacy laws", anchor: "united-states", tone: "blue" },
  { name: "Canada", laws: "PIPEDA · Quebec Law 25", anchor: "canada", tone: "violet" },
  { name: "Africa", laws: "NDPA · POPIA · Kenya DPA", anchor: "africa", tone: "green" },
  { name: "Asia", laws: "DPDP Act · PDPA · APPI · PIPA", anchor: "asia", tone: "amber" },
] as const;

const commitments: { icon: IconName; title: string; body: string }[] = [
  { icon: "ban", title: "We don’t sell your data", body: "We do not sell personal information or use it for targeted advertising." },
  { icon: "cookie", title: "No tracking cookies", body: "Our websites set no cookies and run no analytics or advertising trackers today." },
  { icon: "scale", title: "Your rights, wherever you are", body: "Access, correction, deletion and more, under the law where you live." },
  { icon: "clock", title: "Updated before we launch", body: "We will publish service terms and update these notices before accounts or payments go live." },
];

export default function LegalsHome() {
  return (
    <div className="lp">
      <div className="lp-top">
        <header className="lp-header">
          <BrandLockup tagline="Legals & Compliance" />
          <nav aria-label="Sections">
            <a href="#documents">Documents</a>
            <a href="#responsible">Regions</a>
            <a href="#contact">Contact</a>
          </nav>
        </header>

        <main className="lp-hero">
          <section className="lp-copy" aria-labelledby="headline">
            <p className="lp-status">Updated {legalUpdated}</p>
            <h1 id="headline">Plain-English legals.<br /><span>For every region.</span></h1>
            <p className="lp-lead">Privacy, terms, cookies and company details for BitoCard across Europe, the Americas, Africa and Asia, all in one place.</p>
            <div className="lp-actions">
              <Link className="lp-button lp-button-primary" href="/privacy">Read the privacy notice <span aria-hidden="true">→</span></Link>
              <Link className="lp-button" href="/terms">Terms of use</Link>
            </div>
            <p className="lp-note">BitoCard is coming soon. These documents cover our information websites. Service terms will be published here before launch.</p>
          </section>

          <figure className="coverage" aria-labelledby="coverage-title">
            <div className="coverage-card">
              <div className="coverage-head">
                <span className="coverage-badge"><Icon name="shield" /></span>
                <div><p>Privacy notice</p><h2 id="coverage-title">Your rights, by region</h2></div>
              </div>
              <ul className="coverage-list">
                {regions.map(region => (
                  <li key={region.anchor}>
                    <Link className={`region region-${region.tone}`} href={`/privacy#${region.anchor}`}>
                      <span className="region-icon"><Icon name="globe" /></span>
                      <span className="region-text"><strong>{region.name}</strong><span>{region.laws}</span></span>
                      <span className="region-arrow" aria-hidden="true">›</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <figcaption>Summary · Full details in the privacy notice</figcaption>
          </figure>
        </main>
      </div>

      <section className="lp-section" id="documents" aria-labelledby="documents-title">
        <h2 id="documents-title">Our documents</h2>
        <p className="lp-section-lead">Everything that governs BitoCard’s websites, kept up to date in one place.</p>
        <ul className="doc-grid">
          {legalDocuments.map(doc => (
            <li key={doc.href}>
              <Link className="doc-card" href={doc.href}>
                <span className="doc-icon"><Icon name={documentDetails[doc.href].icon} /></span>
                <strong>{doc.label}</strong>
                <span>{documentDetails[doc.href].summary}</span>
                <span className="doc-more">Read <span aria-hidden="true">→</span></span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="lp-section" aria-labelledby="commitments-title">
        <h2 id="commitments-title">Our commitments</h2>
        <ul className="commitments">
          {commitments.map(item => (
            <li key={item.title}><span className="commitment-icon"><Icon name={item.icon} /></span><h3>{item.title}</h3><p>{item.body}</p></li>
          ))}
        </ul>
      </section>

      <section className="lp-section" id="responsible" aria-labelledby="responsible-title">
        <h2 id="responsible-title">Who is responsible</h2>
        <p className="lp-section-lead">BitoCard is operated by Golojan group companies. The company responsible for you depends on where you are.</p>
        <ul className="entity-grid">
          {legalEntities.map(entity => (
            <li key={entity.name}>
              <p className="entity-regions">{entity.regions}</p>
              <h3>{entity.name}</h3>
              <p>Registered in {entity.jurisdiction}</p>
            </li>
          ))}
        </ul>
        <p className="lp-fineprint">If your region is not listed, Golojan Technologies LLC is responsible. See the <Link href="/notice">legal notice</Link>.</p>
      </section>

      <section className="lp-contact" id="contact" aria-labelledby="contact-title">
        <div>
          <h2 id="contact-title">Questions about privacy or compliance?</h2>
          <p>Email our legal team to ask a question or use your privacy rights. We will reply within the time your local law requires.</p>
        </div>
        <a className="lp-button lp-button-primary" href={`mailto:${legalContact}`}><Icon name="mail" /> {legalContact}</a>
      </section>

      <SiteFooter />
    </div>
  );
}
