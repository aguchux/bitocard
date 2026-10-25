import { notFound } from "next/navigation";
import { ShopFooter } from "@/components/footer";
import { SellButton, ShopHeader } from "@/components/header";
import { marketFor, markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";

/** A country's market (`/ng`…): only where BitoCard Shop is open; everything under it is in that country's currency. */
export default async function CountryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cc: string }> }) {
  const { cc } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const [customer, all] = await Promise.all([currentCustomer(), markets()]);
  return (
    <>
      <header className="bg-navy-900 px-4 py-3">
        <div className="mx-auto max-w-6xl">
          <ShopHeader market={market} customer={customer} showcase={all.showcase} />
        </div>
      </header>
      <main>{children}</main>
      <ShopFooter country={{ code: market.country, name: market.name }} />
      <SellButton customer={customer} />
    </>
  );
}
