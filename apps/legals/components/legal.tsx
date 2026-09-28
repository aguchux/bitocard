import type { ReactNode } from "react";
import { legalContact, legalEntities, legalUpdated, legalUpdatedIso } from "@bitocard/ui/legal";
import { JsonLd } from "@bitocard/ui/seo";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { DocTabs } from "@/components/doc-tabs";
import { documentSchema } from "@/components/seo";

type PageSeo = { title: string; description: string; path: string };

/** Reading layout for one legal document: breadcrumbs, document tabs, then the article. */
export function LegalPage({ seo, intro, children }: { seo: PageSeo; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="page-inner legal-read">
      <JsonLd data={documentSchema(seo)} />
      <Breadcrumbs trail={[{ href: "/", label: "Home" }, { href: "/documents", label: "Documents" }]} current={seo.title} />
      <DocTabs />
      <article className="legal-article" aria-labelledby="legal-title">
        <h1 id="legal-title">{seo.title}</h1>
        <p className="legal-updated">Last updated <time dateTime={legalUpdatedIso}>{legalUpdated}</time></p>
        <div className="legal-intro">{intro}</div>
        {children}
      </article>
    </div>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

export function ContactEmail() {
  return <a href={`mailto:${legalContact}`}>{legalContact}</a>;
}

/** Which Golojan entity is responsible for each region. */
export function EntityTable({ caption }: { caption: string }) {
  return (
    <div className="legal-table">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr><th scope="col">If you are in</th><th scope="col">Responsible entity</th><th scope="col">Registered in</th></tr>
        </thead>
        <tbody>
          {legalEntities.map(entity => (
            <tr key={entity.name}><td>{entity.regions}</td><th scope="row">{entity.name}</th><td>{entity.jurisdiction}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
