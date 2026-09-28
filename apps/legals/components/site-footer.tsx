import Link from "next/link";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl, brand } from "@bitocard/ui/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <span>{brand.credit}</span>
      <nav aria-label="Legal documents">
        {legalDocuments.map(doc => <Link key={doc.href} href={doc.href}>{doc.short}</Link>)}
        <a href={appUrl("storefront")}>bitocard.com</a>
      </nav>
    </footer>
  );
}
