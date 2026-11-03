/* eslint-disable @next/next/no-img-element -- sellers' and stores' photos and logos come from the media CDN at their own sizes. */
import Link from "next/link";
import { ArrowRight, ExternalLink, Store } from "lucide-react";
import type { ShopListingCard, ShopShowcaseCard } from "@bitocard/api-client/classifieds";
import type { HomeLook, HomeStoreCard, HomeTileSize, ResolvedHomeSection } from "@bitocard/api-client/home";
import { ShopIcon } from "../icon";
import { ListingTile } from "../listing-card";
import { Marquee } from "../marquee";

type Of<T extends ResolvedHomeSection["type"]> = Extract<ResolvedHomeSection, { type: T }>;
type Card = ShopListingCard | ShopShowcaseCard;

const rounded = (look: HomeLook) => (look.corners === "round" ? "rounded-3xl" : "rounded-2xl");
const count = (listings: number) => `${listings.toLocaleString("en-GB")} ${listings === 1 ? "listing" : "listings"}`;
/** The masonry's tile sizes on its grid (2 columns on phones, 4 on tablets, 6 on desktops). */
const tileSpans: Record<HomeTileSize, string> = { sm: "", wide: "col-span-2", tall: "row-span-2", lg: "col-span-2 md:row-span-2" };
const tones = { navy: "bg-navy-900 text-white", brand: "bg-brand-700 text-white", light: "bg-navy-50 text-navy-900 ring-1 ring-navy-200" } as const;

function Title({ id, title }: { id: string; title: string }) {
  return title ? (
    <h2 id={id} className="mb-3 text-base font-bold sm:text-lg">
      {title}
    </h2>
  ) : null;
}

/** Listings sliding past (the picks first): each card as everywhere else. */
export function ListingMarqueeBlock({ section }: { section: Of<"listing_marquee"> }) {
  const id = `home-${section.id}`;
  const label = section.title || "Listings";
  const width = section.cards === "compact" ? "w-36 sm:w-44" : "w-40 sm:w-48";
  return (
    <section aria-labelledby={section.title ? id : undefined} aria-label={section.title ? undefined : label}>
      <Title id={id} title={section.title} />
      <Marquee label={label} count={section.data.items.length} speed={section.speed} direction={section.direction}>
        {section.data.items.map(card => (
          <li key={card.id} className={width}>
            <ListingTile card={card as Card} was={card.was_price} className="h-full" />
          </li>
        ))}
      </Marquee>
    </section>
  );
}

/** A reseller's store: its logo (or initials on its colour), name and listings, opening its own site. */
export function StoreCard({ store, look }: { store: HomeStoreCard; look: HomeLook }) {
  const initials = store.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]!.toUpperCase())
    .join("");
  return (
    <a href={store.url} rel="noopener" className={`flex h-full items-center gap-3 border border-navy-200 bg-white p-3 text-navy-900 hover:border-navy-400 ${rounded(look)}`}>
      {store.logo_url ? (
        <img src={store.logo_url} alt="" loading="lazy" className="size-12 shrink-0 rounded-xl object-contain ring-1 ring-navy-100" />
      ) : (
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-xl text-sm font-bold text-white" style={{ backgroundColor: store.primary_color }}>
          {initials || <Store className="size-5" />}
        </span>
      )}
      <span className="grid min-w-0 gap-0.5">
        <strong className="truncate text-sm font-bold">{store.name}</strong>
        <span className="text-xs text-navy-600">{store.listings ? count(store.listings) : "Visit the store"}</span>
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
          Visit store <ExternalLink className="size-3" aria-hidden="true" />
        </span>
      </span>
    </a>
  );
}

/** Resellers' stores sliding past. */
export function StoreMarqueeBlock({ section, look }: { section: Of<"store_marquee">; look: HomeLook }) {
  const id = `home-${section.id}`;
  const label = section.title || "Stores";
  return (
    <section aria-labelledby={section.title ? id : undefined} aria-label={section.title ? undefined : label}>
      <Title id={id} title={section.title} />
      <Marquee label={label} count={section.data.stores.length} speed={section.speed} direction={section.direction}>
        {section.data.stores.map(store => (
          <li key={store.id} className="w-64">
            <StoreCard store={store} look={look} />
          </li>
        ))}
      </Marquee>
    </section>
  );
}

/** Tiles of any kind (a category, a listing, a photo) as a masonry: 2 columns on phones, 4 on tablets, 6 on desktops. */
export function MasonryGridBlock({ section, look }: { section: Of<"masonry_grid">; look: HomeLook }) {
  const id = `home-${section.id}`;
  return (
    <section aria-labelledby={section.title ? id : undefined} aria-label={section.title ? undefined : "Featured"}>
      <Title id={id} title={section.title} />
      <ul className="grid grid-flow-row-dense auto-rows-[7.5rem] grid-cols-2 gap-2.5 min-[380px]:auto-rows-[8.5rem] sm:gap-3 md:auto-rows-[9.5rem] md:grid-cols-4 lg:grid-cols-6">
        {section.data.tiles.map((tile, index) => (
          <li key={`${tile.kind}-${index}`} className={tileSpans[tile.size]}>
            <Link href={tile.href} className={`group relative flex size-full items-end overflow-hidden bg-brand-50 ${rounded(look)}`}>
              {tile.image ? (
                <img src={tile.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-brand-700" aria-hidden="true">
                  <ShopIcon name="package" className="size-10" />
                </span>
              )}
              {tile.image ? <span className="absolute inset-0 bg-gradient-to-t from-navy-900/80 via-navy-900/10 to-transparent" aria-hidden="true" /> : null}
              <span className={`relative grid min-w-0 gap-0.5 p-3 ${tile.image ? "text-white" : "text-navy-900"}`}>
                {tile.title ? <strong className="line-clamp-2 text-sm leading-tight font-bold sm:text-[15px]">{tile.title}</strong> : null}
                {tile.kind === "category" && tile.listings !== undefined ? <span className={`text-xs ${tile.image ? "text-white/85" : "text-navy-600"}`}>{count(tile.listings)}</span> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A banner for one category: the whole banner opens it. Split (photo beside the words) or overlay (words on the photo). */
export function CategoryBannerBlock({ section, look }: { section: Of<"category_banner">; look: HomeLook }) {
  const { category, href, image } = section.data;
  if (!category || !href) return null;
  const title = section.data.title || category.name;
  const meta = section.showCount ? count(category.listings) : null;
  const words = (
    <span className="relative grid max-w-md gap-1.5">
      <strong className="text-lg leading-tight font-extrabold sm:text-xl">{title}</strong>
      {section.body ? <span className="text-sm opacity-90">{section.body}</span> : null}
      {meta ? <span className="text-xs opacity-80">{meta}</span> : null}
      <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold">
        {section.cta || "Shop now"} <ArrowRight className="size-4" aria-hidden="true" />
      </span>
    </span>
  );
  if (section.style === "overlay" && image) {
    return (
      <Link href={href} className={`relative flex min-h-40 items-end overflow-hidden p-5 text-white sm:min-h-48 sm:p-6 ${rounded(look)}`}>
        <img src={image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
        <span className="absolute inset-0 bg-gradient-to-r from-navy-900/85 via-navy-900/45 to-transparent" aria-hidden="true" />
        {words}
      </Link>
    );
  }
  return (
    <Link href={href} className={`grid min-h-40 grid-cols-[1fr_auto] items-stretch overflow-hidden sm:min-h-48 ${tones[section.tone]} ${rounded(look)}`}>
      <span className="flex items-end p-5 sm:p-6">{words}</span>
      {image ? (
        <img src={image} alt="" loading="lazy" className="h-full w-32 object-cover sm:w-44" />
      ) : (
        <span className="grid w-28 place-items-center opacity-80 sm:w-36" aria-hidden="true">
          <ShopIcon name={category.icon} className="size-12" />
        </span>
      )}
    </Link>
  );
}
