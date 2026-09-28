import type { ReactNode } from "react";
import { legalContact, legalEntities, legalUpdated, legalUpdatedIso } from "@bitocard/ui/legal";
import { JsonLd } from "@bitocard/ui/seo";
import { PageBanner } from "@/components/blocks";
import { documentSchema } from "@/components/seo";

type PageSeo = { title: string; description: string; path: string };

/** One legal document: banner with breadcrumbs, title and date, then the article. Switch documents from the header's Documents menu. */
export function LegalPage({ seo, intro, children }: { seo: PageSeo; intro: ReactNode; children: ReactNode }) {
  return (
    <>
      <JsonLd data={documentSchema(seo)} />
      <PageBanner
        trail={[{ href: "/", label: "Home" }, { href: "/documents", label: "Documents" }]}
        current={seo.title}
        eyebrow={<>Last updated <time dateTime={legalUpdatedIso}>{legalUpdated}</time></>}
        title={seo.title}
        titleId="legal-title"
      />
      <div className="page-inner legal-read">
        <article className="legal-article" aria-labelledby="legal-title">
          <div className="legal-intro">{intro}</div>
          {children}
        </article>
      </div>
    </>
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
