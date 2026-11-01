/* eslint-disable @next/next/no-img-element -- admins' banners and sellers' photos come from the media CDN at their own sizes; tiles crop them. */
import Link from "next/link";
import { ArrowRight, BadgeCheck, CreditCard, Gift, Globe2, Headphones, Lock, LineChart, Phone, ShieldCheck, Star, Timer, Zap, Coins, type LucideIcon } from "lucide-react";
import type { ShopListingCard, ShopShowcaseCard } from "@bitocard/api-client/classifieds";
import type { ClassifiedHome, HomeCard, HomeLook, HomeTile, ResolvedHomeSection } from "@bitocard/api-client/home";
import type { TrustIcon } from "@bitocard/api-client/storefront";
import { Flag } from "../flag";
import { ShopIcon } from "../icon";
import { ListingGrid, ListingTile } from "../listing-card";
import { Slider } from "../slider";

type Of<T extends ResolvedHomeSection["type"]> = Extract<ResolvedHomeSection, { type: T }>;
type Card = ShopListingCard | ShopShowcaseCard;

/** Desktop and tablet widths (12 and 6 columns); phones are always full width. Written out so Tailwind keeps them. */
const lgSpans: Record<number, string> = { 3: "lg:col-span-3", 4: "lg:col-span-4", 6: "lg:col-span-6", 8: "lg:col-span-8", 9: "lg:col-span-9", 12: "lg:col-span-12" };
const mdSpans: Record<number, string> = { 3: "md:col-span-3", 6: "md:col-span-6" };
const gaps: Record<HomeLook["density"], string> = { compact: "gap-5 lg:gap-6", comfortable: "gap-7 lg:gap-9", airy: "gap-9 lg:gap-12" };
const heroTones: Record<HomeLook["hero"], { band: string; accent: string; body: string }> = {
  navy: { band: "bg-navy-900 text-white", accent: "text-brand-300", body: "text-white/80" },
  brand: { band: "bg-brand-700 text-white", accent: "text-white/85", body: "text-white/85" },
  light: { band: "bg-navy-50 text-navy-900", accent: "text-brand-700", body: "text-navy-600" },
};
const bannerTones = { navy: "bg-navy-900 text-white", brand: "bg-brand-700 text-white", light: "bg-navy-50 text-navy-900 ring-1 ring-navy-200" } as const;
/** The masonry's tile sizes on its grid (2 columns on phones, 4 on tablets, 6 on desktops); a large tile is one row tall on phones. */
const tileSpans: Record<HomeTile["size"], string> = { sm: "", wide: "col-span-2", tall: "row-span-2", lg: "col-span-2 md:row-span-2" };
const trustIcons: Record<TrustIcon, LucideIcon> = { lock: Lock, bolt: Zap, card: CreditCard, globe: Globe2, shield: ShieldCheck, support: Headphones, gift: Gift, phone: Phone, coin: Coins, chart: LineChart, clock: Timer, star: Star };

const rounded = (look: HomeLook) => (look.corners === "round" ? "rounded-3xl" : "rounded-2xl");
/** Card widths in a sliding row, by the layout's cards. */
const railItem = (look: HomeLook) => (look.cards === "compact" ? "w-36 sm:w-44" : look.cards === "large" ? "w-56 sm:w-64" : "w-40 sm:w-48");

/** Whether a section has anything to show (an empty rail, tile set or country list is left out). */
export function showsSomething(section: ResolvedHomeSection) {
  switch (section.type) {
    case "category_masonry":
      return section.data.tiles.length > 0;
    case "deals_rail":
    case "sponsored_rail":
    case "top_selling_rail":
    case "listing_group":
      return section.data.items.length > 0;
    case "country_tiles":
      return section.data.countries.length > 0;
    default:
      return true;
  }
}

function Heading({ id, title, href }: { id: string; title: string; href?: string | null }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="min-w-0 text-base font-bold sm:text-lg">
        {title}
      </h2>
      {href ? (
        <Link href={href} className="shrink-0 text-[13px] font-semibold text-brand-700 hover:underline">
          See all
        </Link>
      ) : null}
    </div>
  );
}

/** A row of listings that slides, or a grid; Sponsored ones say so, deals show their "was" price. */
function Listings({ id, title, items, look, display = "rail", href, badge }: { id: string; title: string; items: HomeCard[]; look: HomeLook; display?: "rail" | "grid"; href?: string | null; badge?: string }) {
  return (
    <section aria-labelledby={id}>
      <Heading id={id} title={title} href={href} />
      {display === "grid" && !badge ? (
        <ListingGrid cards={items as Card[]} />
      ) : (
        <Slider label={title}>
          {items.map(card => (
            <li key={card.id} className={railItem(look)}>
              <ListingTile card={card as Card} badge={card.sponsored ? badge : undefined} was={card.was_price} className="h-full" />
            </li>
          ))}
        </Slider>
      )}
    </section>
  );
}

function Hero({ section, look, bleed }: { section: Of<"home_hero">; look: HomeLook; bleed: boolean }) {
  const tone = heroTones[look.hero];
  const slides = section.style === "carousel" ? section.data.slides : [];
  const text = (
    <div className="grid gap-2">
      <h1 className="text-[22px] leading-tight font-extrabold sm:text-3xl lg:text-4xl">
        {section.title}
        {section.accent ? (
          <>
            <br />
            <span className={tone.accent}>{section.accent}</span>
          </>
        ) : null}
      </h1>
      {section.subtitle ? <p className={`max-w-2xl text-sm sm:text-base ${tone.body}`}>{section.subtitle}</p> : null}
    </div>
  );
  if (slides.length) {
    return (
      <section aria-label={section.title} className={bleed ? "mx-auto w-full max-w-[1400px] px-4 pt-4 sm:px-6 lg:px-8" : ""}>
        <h1 className="sr-only">{section.title}</h1>
        <Slider label={section.title}>
          {slides.map((slide, index) => (
            <li key={index} className="w-[88%] sm:w-[70%] lg:w-[60%]">
              <Link href={slide.href} className={`relative block aspect-[16/9] overflow-hidden bg-navy-900 sm:aspect-[21/9] ${rounded(look)}`}>
                <img src={slide.image} alt="" className="absolute inset-0 size-full object-cover" loading={index ? "lazy" : "eager"} />
                <span className="absolute inset-0 bg-gradient-to-t from-navy-900/85 via-navy-900/30 to-transparent" aria-hidden="true" />
                <span className="absolute inset-x-0 bottom-0 grid gap-1 p-4 text-white sm:p-6">
                  <strong className="text-lg leading-tight font-extrabold sm:text-2xl">{slide.title}</strong>
                  {slide.subtitle ? <span className="text-sm text-white/85">{slide.subtitle}</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </Slider>
      </section>
    );
  }
  if (section.style === "minimal") {
    return <section className={bleed ? "mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8" : ""}>{text}</section>;
  }
  return bleed ? (
    <section className={`${tone.band} pt-6 pb-6 sm:pt-8 sm:pb-8`}>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">{text}</div>
    </section>
  ) : (
    <section className={`${tone.band} p-5 sm:p-7 ${rounded(look)}`}>{text}</section>
  );
}

function Masonry({ section, look }: { section: Of<"category_masonry">; look: HomeLook }) {
  const id = `home-${section.id}`;
  return (
    <section aria-labelledby={id}>
      <Heading id={id} title={section.title} />
      <ul className="grid grid-flow-row-dense auto-rows-[7.5rem] grid-cols-2 gap-2.5 min-[380px]:auto-rows-[8.5rem] sm:gap-3 md:auto-rows-[9.5rem] md:grid-cols-4 lg:grid-cols-6">
        {section.data.tiles.map(tile => (
          <li key={tile.slug} className={tileSpans[tile.size]}>
            <Link href={tile.href} className={`group relative flex size-full items-end overflow-hidden bg-brand-50 ${rounded(look)}`}>
              {tile.image ? (
                <img src={tile.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-105 motion-reduce:transition-none" />
              ) : (
                <span className="absolute inset-0 grid place-items-center text-brand-700" aria-hidden="true">
                  <ShopIcon name={tile.icon} className="size-10" />
                </span>
              )}
              {tile.image ? <span className="absolute inset-0 bg-gradient-to-t from-navy-900/80 via-navy-900/10 to-transparent" aria-hidden="true" /> : null}
              <span className={`relative grid min-w-0 gap-0.5 p-3 ${tile.image ? "text-white" : "text-navy-900"}`}>
                <strong className="line-clamp-2 text-sm leading-tight font-bold sm:text-[15px]">{tile.name}</strong>
                <span className={`text-xs ${tile.image ? "text-white/85" : "text-navy-600"}`}>{`${tile.listings.toLocaleString("en-GB")} ${tile.listings === 1 ? "listing" : "listings"}`}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Banners({ section, look }: { section: Of<"banner">; look: HomeLook }) {
  return (
    <section aria-label={section.data.items.map(item => item.title).join(", ")} className={`grid gap-3 ${section.data.items.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {section.data.items.map((item, index) => (
        <Link key={index} href={item.href} className={`relative flex min-h-36 items-end overflow-hidden p-5 sm:min-h-44 sm:p-6 ${item.image ? "text-white" : bannerTones[item.tone]} ${rounded(look)}`}>
          {item.image ? (
            <>
              <img src={item.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
              <span className="absolute inset-0 bg-gradient-to-r from-navy-900/85 via-navy-900/45 to-transparent" aria-hidden="true" />
            </>
          ) : null}
          <span className="relative grid max-w-md gap-1.5">
            <strong className="text-lg leading-tight font-extrabold sm:text-xl">{item.title}</strong>
            {item.body ? <span className="text-sm opacity-90">{item.body}</span> : null}
            <span className="mt-1 inline-flex items-center gap-1 text-sm font-bold">
              Go <ArrowRight className="size-4" aria-hidden="true" />
            </span>
          </span>
        </Link>
      ))}
    </section>
  );
}

function Countries({ section, look }: { section: Of<"country_tiles">; look: HomeLook }) {
  const id = `home-${section.id}`;
  return (
    <section aria-labelledby={id}>
      <Heading id={id} title={section.title} />
      <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">
        {section.data.countries.map(country => (
          <li key={country.country}>
            {/* A plain link: opening it chooses the country, remembered for the home page (never prefetched). */}
            <a href={country.href} rel="nofollow" className={`flex items-center gap-3 border border-navy-200 bg-white p-3 hover:border-navy-400 sm:p-4 ${rounded(look)}`}>
              <Flag country={country.country} className="h-6 w-9" />
              <span className="grid min-w-0">
                <strong className="truncate text-sm font-bold sm:text-base">{country.name}</strong>
                <span className="text-xs text-navy-600">{`${country.listings.toLocaleString("en-GB")} ${country.listings === 1 ? "listing" : "listings"}`}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Trust({ section, look }: { section: Of<"trust_bar">; look: HomeLook }) {
  return (
    <section aria-label="Why Udozo" className={`grid grid-cols-1 gap-4 bg-white p-5 ring-1 ring-navy-100 min-[400px]:grid-cols-2 lg:grid-cols-4 ${rounded(look)}`}>
      {section.items.map((item, index) => {
        const Icon = trustIcons[item.icon] ?? BadgeCheck;
        return (
          <div key={index} className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <span className="grid min-w-0 gap-0.5">
              <strong className="text-sm font-bold">{item.title}</strong>
              {item.body ? <span className="text-xs text-navy-600">{item.body}</span> : null}
            </span>
          </div>
        );
      })}
    </section>
  );
}

function One({ section, look }: { section: ResolvedHomeSection; look: HomeLook }) {
  const id = `home-${section.id}`;
  switch (section.type) {
    case "home_hero":
      return <Hero section={section} look={look} bleed={false} />;
    case "category_masonry":
      return <Masonry section={section} look={look} />;
    case "deals_rail":
      return <Listings id={id} title={section.title} items={section.data.items} look={look} href={section.data.view_all_href} />;
    case "sponsored_rail":
      return <Listings id={id} title={section.title} items={section.data.items} look={look} badge="Sponsored" />;
    case "top_selling_rail":
      return <Listings id={id} title={section.data.heading} items={section.data.items} look={look} />;
    case "listing_group":
      return <Listings id={id} title={section.title} items={section.data.items} look={look} display={section.display} href={section.data.view_all_href} />;
    case "banner":
      return <Banners section={section} look={look} />;
    case "country_tiles":
      return <Countries section={section} look={look} />;
    case "trust_bar":
      return <Trust section={section} look={look} />;
  }
}

/**
 * A home page laid out by Udozo's admins: a hero first runs edge to edge, then every section on a grid that is one
 * column on phones, 6 on tablets and 12 on desktops (each section's own width from tablets up). Sections with nothing to
 * show are left out; the layout's look sets the hero's colour, the cards, corners and spacing.
 */
export function HomeSections({ home }: { home: ClassifiedHome }) {
  const shown = home.sections.filter(section => !section.hidden && showsSomething(section));
  const [first, ...rest] = shown;
  const leadHero = first?.type === "home_hero" ? first : null;
  const body = leadHero ? rest : shown;
  return (
    <div data-home-layout={home.layout}>
      {leadHero ? <Hero section={leadHero} look={home.look} bleed /> : null}
      <div className={`mx-auto grid max-w-[1400px] grid-cols-1 px-4 pt-5 pb-4 sm:px-6 md:grid-cols-6 lg:grid-cols-12 lg:px-8 ${gaps[home.look.density]}`}>
        {body.map(section => (
          <div key={section.id} className={`min-w-0 ${mdSpans[section.span.md] ?? "md:col-span-6"} ${lgSpans[section.span.lg] ?? "lg:col-span-12"}`}>
            <One section={section} look={home.look} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The first ordinary listing section's cards (never Sponsored), for search engines' ItemList. */
export function firstListingSection(home: ClassifiedHome) {
  const isListings = (item: ResolvedHomeSection): item is Of<"listing_group"> | Of<"deals_rail"> | Of<"top_selling_rail"> => item.type === "listing_group" || item.type === "deals_rail" || item.type === "top_selling_rail";
  const section = home.sections.filter(isListings).find(item => !item.hidden && item.data.items.length > 0);
  if (!section) return null;
  return { title: section.type === "top_selling_rail" ? section.data.heading : section.title, cards: section.data.items as ShopListingCard[] };
}
