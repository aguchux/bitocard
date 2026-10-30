import { notFound } from "next/navigation";
import { SiteFooter } from "@/components/footer";
import { AssistantProvider } from "@/components/assistant";
import { SellButton, SiteHeader } from "@/components/header";
import { InstallPrompt } from "@bitocard/ui/install-ui";
import { assistantFor } from "@/lib/assistant";
import { marketFor, markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";

/**
 * A country's market (`/ng`…): only where Udozo is open; everything under it is in that country's currency.
 * Where the country's shop assistant answers, Ask Anjio opens it from the header, the search box and listing pages.
 * Where an admin switched it on, visitors are asked to install the site as an app (`InstallPrompt`).
 */
export default async function CountryLayout({ children, params }: { children: React.ReactNode; params: Promise<{ cc: string }> }) {
  const { cc } = await params;
  const market = await marketFor(cc);
  if (!market) notFound();
  const [customer, all, assistant] = await Promise.all([currentCustomer(), markets(), assistantFor(market.country)]);
  return (
    <AssistantProvider country={market.country} profile={assistant} signedIn={Boolean(customer)}>
      <SiteHeader market={market} customer={customer} showcase={all.showcase} />
      <main>{children}</main>
      <SiteFooter country={{ code: market.country, name: market.name }} />
      <SellButton customer={customer} />
      <InstallPrompt enabled={market.install_prompt} appName="Udozo" />
    </AssistantProvider>
  );
}
