import type { ReactNode } from "react";
import { Brand } from "./brand";
import { brand } from "./site";

/** Shared coming-soon page for the docs, admin and reseller workspaces. */
export function ComingSoon({ title, lead, heading, children }: { title: string; lead: string; heading: string; children: ReactNode }) {
  return (
    <main className="workspace">
      <header><span className="wordmark"><Brand /></span></header>
      <p className="badge">Coming soon</p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      <section aria-labelledby="workspace-heading"><h2 id="workspace-heading">{heading}</h2><p>{children}</p></section>
      <footer>{brand.credit}</footer>
    </main>
  );
}
