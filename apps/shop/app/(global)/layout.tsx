import { ShopFooter } from "@/components/footer";
import { ShopHeader } from "@/components/header";
import { markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";

/** Pages across countries (the showcase, the Safe Trade Guide) and signing in: no country chosen. */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const [customer, all] = await Promise.all([currentCustomer(), markets()]);
  const own = all.data.find(market => market.country === customer?.country) ?? null;
  return (
    <>
      <header className="bg-navy-900 px-4 py-3">
        <div className="mx-auto max-w-6xl">
          <ShopHeader market={all.showcase ? null : own ?? all.data[0] ?? null} customer={customer} showcase={all.showcase} />
        </div>
      </header>
      <main>{children}</main>
      <ShopFooter />
    </>
  );
}
