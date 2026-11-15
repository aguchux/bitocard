import Link from "next/link";
import { ChevronRight, Gift, HandCoins, type LucideIcon } from "lucide-react";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";

/** The catalogue's gift card group. */
export const giftCardGroup = "gift-cards";

/** The catalogue's gift cards to choose one to sell: each card then opens on its Sell tab. */
export const sellCatalogHref = `/account/catalog?group=${giftCardGroup}&sell=1`;

/** How many gift cards are on sale in the group, from the menu's own counts. */
export function giftCardCount(group: StoreNavigationGroup | undefined) {
  return group?.categories.reduce((sum, category) => sum + (category.on_sale ? category.products : 0), 0) ?? 0;
}

function ActionCard({ icon: Icon, tile, title, text, href, soon }: { icon: LucideIcon; tile: string; title: string; text: string; href?: string; soon?: boolean }) {
  const body = (
    <>
      <span className={`grid size-12 place-items-center rounded-full text-white ${tile}`}>
        <Icon className="size-6" aria-hidden="true" strokeWidth={2} />
      </span>
      <span className="mt-5 flex items-center gap-2">
        <span className="text-lg font-bold text-navy-900">{title}</span>
        {soon ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">Soon</span> : null}
        {href ? <ChevronRight className="ml-auto size-5 text-slate-400" aria-hidden="true" /> : null}
      </span>
      <span className="mt-1 block text-[15px] leading-relaxed text-slate-600">{text}</span>
    </>
  );
  const className = "flex h-full flex-col rounded-3xl bg-white p-5 ring-1 ring-slate-200/70 sm:p-6";
  return href ? (
    <Link href={href} className={`${className} transition hover:-translate-y-0.5 hover:shadow-md`}>
      {body}
    </Link>
  ) : (
    <div className={className} aria-disabled="true">
      {body}
    </div>
  );
}

/**
 * Gift cards on the customer's Home: "I want to" buy them (the catalogue's gift cards) or sell them. Selling happens
 * on each card's page (its Sell tab), so Sell opens the gift cards where selling is open in the customer's country;
 * elsewhere it says Soon and links nowhere.
 */
export function GiftCardActions({ group, sellOpen = false }: { group: StoreNavigationGroup | undefined; sellOpen?: boolean }) {
  const count = giftCardCount(group);
  const onSale = Boolean(group?.on_sale) && count > 0;
  return (
    <section aria-labelledby="gift-cards">
      <h2 id="gift-cards" className="text-xl font-extrabold tracking-tight text-navy-900">
        Gift cards
      </h2>
      <p className="mt-1 mb-3 text-slate-500">I want to</p>
      <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 xl:max-w-4xl">
        <li>
          <ActionCard
            icon={Gift}
            tile="bg-indigo-400"
            title="Buy gift cards"
            text={onSale ? `Choose from ${count.toLocaleString("en-GB")} local and international gift cards, delivered to your account.` : "Gift cards are coming to your country soon."}
            href={onSale ? `/account/catalog?group=${giftCardGroup}` : undefined}
            soon={!onSale}
          />
        </li>
        <li>
          {sellOpen ? (
            <ActionCard icon={HandCoins} tile="bg-pink-400" title="Sell gift cards" text="Choose your card, then Sell. The money goes into your wallet once the card is accepted." href={sellCatalogHref} />
          ) : (
            <ActionCard icon={HandCoins} tile="bg-pink-400" title="Sell gift cards" text="Sell your unused local and international gift cards for money in your wallet." soon />
          )}
        </li>
      </ul>
    </section>
  );
}
