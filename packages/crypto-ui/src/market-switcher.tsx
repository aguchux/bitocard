import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { globalMarket, type MarketChoice } from "./market";

/** A market's name in the switcher: the global market by its name, a country with its currencies. */
const label = (market: MarketChoice) => (market.market === globalMarket ? "Global (USD)" : `${market.name} (${market.currencies.join(", ")})`);

/**
 * The markets a customer can trade in, as BitoCard's underlined tabs: their own first, the global market, then other
 * countries taking cross-border trades. Shown only when there is more than one. `href` gives each market's address
 * and `current` the chosen one's.
 */
export function MarketSwitcher({ markets, current, href, bleed = true, className = "" }: { markets: MarketChoice[]; current: string; href: (market: MarketChoice) => string; bleed?: boolean; className?: string }) {
  if (markets.length < 2) return null;
  return <UnderlineTabs label="Market" tabs={markets.map(market => ({ href: href(market), label: label(market) }))} current={current} bleed={bleed} className={className} />;
}
