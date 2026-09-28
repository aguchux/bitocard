import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

/** Shell for Documents, the individual documents and Contact. Home has its own full-screen hero. */
export default function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="lp page">
      <div className="page-top"><SiteHeader /></div>
      <main className="page-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
