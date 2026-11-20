import { Gift, HandCoins } from "lucide-react";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { ActionCard, giftCardCount, giftCardGroup, sellCatalogHref } from "./gift-card-actions";
import { homeCards } from "./mobile-actions";
import { ActionRow } from "./action-row";

/**
 * Home's "I want to": buying and selling gift cards, then airtime and data (topping up, and the airtime exchange's
 * selling and buying), as one set of equal cards. Three across in two rows on desktops; one row that slides sideways
 * (snapping, the next card peeking, no scroll bar; swiped, or dragged and stepped with arrows by a mouse) on phones and tablets. An action not offered on the store is left out; buying gift cards always opens their catalogue.
 */
export function HomeActions({ giftCards, sellOpen, topUpOpen, exchangeOpen }: { giftCards: StoreNavigationGroup | undefined; sellOpen: boolean; topUpOpen: boolean; exchangeOpen: boolean }) {
  const count = giftCardCount(giftCards);
  const giftsOnSale = Boolean(giftCards?.on_sale) && count > 0;
  const cards = [
    {
      key: "buy-gift-cards",
      icon: Gift,
      tile: "bg-indigo-400",
      title: "Buy gift cards",
      text: giftsOnSale ? `Choose from ${count.toLocaleString("en-GB")} local and international gift cards, delivered to your account.` : "Local and international gift cards, delivered to your account.",
      href: `/account/catalog?group=${giftCardGroup}`,
    },
    {
      key: "sell-gift-cards",
      icon: HandCoins,
      tile: "bg-pink-400",
      title: "Sell gift cards",
      text: sellOpen ? "Choose your card, then Sell. The money goes into your wallet once the card is accepted." : "Sell your unused local and international gift cards for money in your wallet.",
      href: sellOpen ? sellCatalogHref : undefined,
    },
    ...homeCards.map(card => {
      const open = card.exchange ? exchangeOpen : topUpOpen;
      return { key: card.href, icon: card.icon, tile: card.tile, title: card.label, text: card.text, href: open ? card.href : undefined };
    }),
  ];
  return (
    <section aria-labelledby="home-actions">
      <h2 id="home-actions" className="mb-3 text-xl font-extrabold tracking-tight text-navy-900">
        I want to
      </h2>
      <ActionRow
        label="What you can do"
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:auto-rows-fr lg:grid-cols-3 lg:gap-4 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {cards.filter(card => card.href).map(card => (
          <li key={card.key} className="relative w-[80%] shrink-0 snap-start sm:w-[45%] lg:w-auto">
            <ActionCard icon={card.icon} tile={card.tile} title={card.title} text={card.text} href={card.href} />
          </li>
        ))}
      </ActionRow>
    </section>
  );
}
