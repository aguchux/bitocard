import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import { currentCustomer } from "@/lib/session";

/** The public site: pos.udozo.com's own header and footer, with Open POS once the owner is signed in. */
export default async function SiteLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const customer = await currentCustomer();
  return (
    <>
      <SiteHeader signedIn={Boolean(customer)} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
