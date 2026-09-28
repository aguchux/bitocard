import { BrandLockup } from "@bitocard/ui/brand-lockup";
import { appUrl } from "@bitocard/ui/site";
import { LegalNav } from "@/components/legal-nav";
import { SiteFooter } from "@/components/site-footer";

/** Reading layout for the legal documents. */
export default function DocumentsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="legal-shell">
      <header className="legal-header">
        <BrandLockup tagline="Legals & Compliance" />
        <a className="legal-back" href={appUrl("storefront")}>Back to BitoCard</a>
      </header>
      <LegalNav />
      <main className="legal-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
