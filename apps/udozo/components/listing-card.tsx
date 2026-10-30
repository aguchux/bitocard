/* eslint-disable @next/next/no-img-element -- sellers' photos come from the media CDN at their own sizes; the card crops them. */
import Link from "next/link";
import { BadgeCheck, ImageIcon, Play, Truck } from "lucide-react";
import { conditionLabels, listingPath, postedAgo, shopPriceText, type ShopListingCard, type ShopResult, type ShopShowcaseCard } from "@bitocard/api-client/classifieds";

type Card = ShopListingCard | ShopShowcaseCard;

const hasPrice = (card: Card): card is ShopListingCard => "price" in card;

function Cover({ card, className }: { card: Card; className: string }) {
  return (
    <span className={`relative block overflow-hidden bg-navy-100 ${className}`}>
      {card.cover ? (
        <img src={card.cover.url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <span className="grid size-full place-items-center text-navy-400">
          <ImageIcon className="size-8" aria-hidden="true" />
        </span>
      )}
      {card.condition ? <span className="absolute top-2 left-2 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-navy-600">{conditionLabels[card.condition]}</span> : null}
      {card.has_video ? (
        <span className="absolute right-2 bottom-2 grid size-6 place-items-center rounded-full bg-navy-900/70 text-white" title="Has a video">
          <Play className="size-3" aria-hidden="true" />
          <span className="sr-only">Has a video</span>
        </span>
      ) : null}
    </span>
  );
}

const place = (card: Card) => `${card.area.name}, ${card.area.state.name}`;

/** A listing in a grid: photo, price (country pages only), title, place and when. */
export function ListingTile({ card, now }: { card: Card; now?: number }) {
  return (
    <Link href={listingPath(card.country, card.ref, card.slug)} className="flex flex-col overflow-hidden rounded-2xl border border-navy-200 bg-white text-navy-900 hover:border-navy-400">
      <Cover card={card} className="aspect-[4/3]" />
      <span className="flex min-w-0 flex-col gap-0.5 p-2.5 pb-3">
        {hasPrice(card) ? <strong className="text-[15px] font-extrabold">{shopPriceText(card.price)}</strong> : null}
        <span className="line-clamp-2 text-[13px] leading-snug font-medium">{card.title}</span>
        <span className="truncate text-xs text-navy-600">
          {card.area.name} · {postedAgo(card.published_at, now)}
        </span>
      </span>
    </Link>
  );
}

/** A listing in a results list: photo beside price, condition, title, its first features, place and delivery. */
export function ListingRow({ card, now }: { card: ShopResult | ShopListingCard; now?: number }) {
  const delivers = "delivers_to_you" in card && card.delivers_to_you;
  return (
    <Link href={listingPath(card.country, card.ref, card.slug)} className="flex gap-3 rounded-2xl border border-navy-200 bg-white p-2.5 text-navy-900 hover:border-navy-400">
      <Cover card={card} className="size-24 shrink-0 rounded-xl sm:size-28" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <strong className="text-[15px] font-extrabold">{shopPriceText(card.price)}</strong>
          {card.price.kind === "negotiable" ? <span className="text-xs font-semibold text-navy-500">Negotiable</span> : null}
        </span>
        <span className="line-clamp-2 text-sm leading-snug font-medium">{card.title}</span>
        {card.highlights.length ? <span className="truncate text-xs text-navy-600">{card.highlights.join(" · ")}</span> : null}
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-navy-600">
          <span>
            {place(card)} · {postedAgo(card.published_at, now)}
          </span>
          {delivers ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2 py-0.5 font-semibold text-navy-700">
              <Truck className="size-3" aria-hidden="true" /> Delivers to you
            </span>
          ) : null}
          {card.seller.badges.includes("id_checked") ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-mint-50 px-2 py-0.5 font-semibold text-mint-700">
              <BadgeCheck className="size-3" aria-hidden="true" /> ID checked
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

/** A grid of tiles: two across on phones, more as the screen widens. */
export function ListingGrid({ cards, now }: { cards: Card[]; now?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cards.map(card => (
        <ListingTile key={card.id} card={card} now={now} />
      ))}
    </div>
  );
}
