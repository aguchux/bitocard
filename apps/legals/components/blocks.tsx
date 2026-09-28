import Link from "next/link";
import type { ReactNode } from "react";
import { legalContact, legalDocuments, legalEntities } from "@bitocard/ui/legal";
import { commitments, documentDetails, regions } from "@/components/content";
import { Icon } from "@/components/icons";

export function Section({ id, title, lead, children }: { id: string; title: string; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="lp-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {lead ? <p className="lp-section-lead">{lead}</p> : null}
      {children}
    </section>
  );
}

export function PageHero({ eyebrow, title, accent, lead }: { eyebrow: ReactNode; title: string; accent: string; lead: string }) {
  return (
    <section className="page-hero" aria-labelledby="page-title">
      <p className="lp-status">{eyebrow}</p>
      <h1 id="page-title">{title} <span>{accent}</span></h1>
      <p className="lp-lead">{lead}</p>
    </section>
  );
}

export function DocumentCards() {
  return (
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
  );
}

/** Region links into the privacy notice. `variant="card"` is the compact hero list. */
export function RegionLinks({ variant = "grid" }: { variant?: "grid" | "card" }) {
  return (
    <ul className={variant === "card" ? "coverage-list" : "region-grid"}>
      {regions.map(region => (
        <li key={region.anchor}>
          <Link className={`region region-${region.tone}`} href={`/documents/privacy#${region.anchor}`}>
            <span className="region-icon"><Icon name="globe" /></span>
            <span className="region-text"><strong>{region.name}</strong><span>{region.laws}</span></span>
            <span className="region-arrow" aria-hidden="true">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Commitments() {
  return (
    <ul className="commitments">
      {commitments.map(item => (
        <li key={item.title}><span className="commitment-icon"><Icon name={item.icon} /></span><h3>{item.title}</h3><p>{item.body}</p></li>
      ))}
    </ul>
  );
}

export function EntityCards() {
  return (
    <>
      <ul className="entity-grid">
        {legalEntities.map(entity => (
          <li key={entity.name}>
            <p className="entity-regions">{entity.regions}</p>
            <h3>{entity.name}</h3>
            <p>Registered in {entity.jurisdiction}</p>
          </li>
        ))}
      </ul>
      <p className="lp-fineprint">If your region is not listed, Golojan Technologies LLC is responsible. See the <Link href="/documents/notice">legal notice</Link>.</p>
    </>
  );
}

export function ContactBand() {
  return (
    <section className="lp-contact" aria-labelledby="contact-band-title">
      <div>
        <h2 id="contact-band-title">Questions about privacy or compliance?</h2>
        <p>Ask a question or use your privacy rights. We will reply within the time your local law requires.</p>
      </div>
      <div className="lp-contact-actions">
        <Link className="lp-button lp-button-primary" href="/contact">Contact our legal team <span aria-hidden="true">→</span></Link>
        <a className="lp-contact-email" href={`mailto:${legalContact}`}>{legalContact}</a>
      </div>
    </section>
  );
}
