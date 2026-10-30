import { SiteFooter } from "@/components/footer";
import { SiteHeader } from "@/components/header";
import { markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";

/** Pages across countries (the showcase, the Safe Trade Guide) and signing in: no country chosen. */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const [customer, all] = await Promise.all([currentCustomer(), markets()]);
  const own = all.data.find(market => market.country === customer?.country) ?? null;
  return (
    <>
      <SiteHeader market={all.showcase ? null : own ?? all.data[0] ?? null} customer={customer} showcase={all.showcase} />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
