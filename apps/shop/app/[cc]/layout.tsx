import { notFound } from "next/navigation";
import { ShopFooter } from "@/components/footer";
import { AssistantProvider } from "@/components/assistant";
import { SellButton, ShopHeader } from "@/components/header";
import { assistantFor } from "@/lib/assistant";
import { marketFor, markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";

/**
 * A country's market (`/ng`…): only where BitoCard Shop is open; everything under it is in that country's currency.
 * Where the country's shop assistant answers, Ask Anjio opens it from the header, the search box and listing pages.
 */
export default async function CountryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cc: string }> }) {
  const { cc } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const [customer, all, assistant] = await Promise.all([currentCustomer(), markets(), assistantFor(market.country)]);
  return (
    <AssistantProvider country={market.country} profile={assistant} signedIn={Boolean(customer)}>
      <ShopHeader market={market} customer={customer} showcase={all.showcase} />
      <main>{children}</main>
      <ShopFooter country={{ code: market.country, name: market.name }} />
      <SellButton customer={customer} />
    </AssistantProvider>
  );
}
