import type { ReactNode } from "react";
import { legalContact, legalEntities, legalUpdated } from "@bitocard/ui/legal";

export function LegalPage({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <article className="legal-article" aria-labelledby="legal-title">
      <h1 id="legal-title">{title}</h1>
      <p className="legal-updated">Last updated {legalUpdated}</p>
      <div className="legal-intro">{intro}</div>
      {children}
    </article>
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
