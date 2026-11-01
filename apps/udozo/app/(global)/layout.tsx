import { SiteFooter } from "@/components/footer";
import { SiteHeader } from "@/components/header";
import { markets } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";
import { chosenOpenMarket } from "@/lib/market-choice";
import { currentMarketChoice } from "@/lib/market-choice-server";

/**
 * Pages across countries (the showcase, the Safe Trade Guide, help) and signing in. The header follows the country the
 * shopper chose in its menu (`udz_market`), so its search stays in their market; with none chosen (or All countries), no
 * country while several are open.
 */
export default async function GlobalLayout({ children }: { children: React.ReactNode }) {
  const [customer, all, choice] = await Promise.all([currentCustomer(), markets(), currentMarketChoice()]);
  const own = all.data.find(market => market.country === customer?.country) ?? null;
  const chosen = chosenOpenMarket(choice, all.data);
  return (
    <>
      <SiteHeader market={chosen ?? (all.showcase ? null : (own ?? all.data[0] ?? null))} customer={customer} showcase={all.showcase} />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
