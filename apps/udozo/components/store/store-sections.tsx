import Link from "next/link";
import type { ResolvedSection, StoreDesign } from "@bitocard/api-client/storefront";
import { densityGap } from "@/lib/store-theme";
import { ListingGrid, ListingRail, ResaleCategories, ResaleHero, ResaleSearch } from "./resale";

type Style = StoreDesign["style"];

/** A store with no design yet reads as the Resale shop's first one (Showroom). */
export const defaultStyle: Style = { mode: "light", hero: "showroom", corners: "round", cards: "raised", font: "sans", density: "comfortable" };

const bleed = "ml-[calc(50%-50vw)] w-screen overflow-x-clip";
const inner = "mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8";

/** Whether a section has anything to show: rails, grids and categories with nothing on sale are left out. */
export function showsSomething(section: ResolvedSection) {
  if (section.type === "listing_rail" || section.type === "listing_grid") return section.data.listings.length > 0;
  if (section.type === "resale_categories") return section.data.categories.length > 0;
  return section.type === "hero";
}

/**
 * A Resale shop's home page, as its owner laid it out in Seller HQ: the hero in the design's variant (edge to edge when it
 * comes first), then rails, grids and categories of what the store sells now, in order.
 */
export function StoreSections({ sections, design }: { sections: ResolvedSection[]; design: StoreDesign | null }) {
  const style = design?.style ?? defaultStyle;
  const shown = sections.filter(showsSomething);
  const selling = shown.some(section => section.type !== "hero");
  return (
    <div className={`grid ${densityGap[style.density]}`}>
      {shown.map((section, index) => {
        switch (section.type) {
          case "hero":
            return <ResaleHero key={section.id} section={section} style={style} frame={index === 0 ? bleed : "overflow-hidden rounded-3xl"} inner={index === 0 ? inner : "px-6"} />;
          case "listing_rail":
            return <ListingRail key={section.id} section={section} />;
          case "listing_grid":
            return <ListingGrid key={section.id} section={section} />;
          case "resale_categories":
            return <ResaleCategories key={section.id} section={section} />;
          default:
            return null;
        }
      })}
      {selling ? null : <NothingYet />}
    </div>
  );
}

/** A store with nothing on sale yet (or whose page could not be loaded): search and the whole range. */
export function NothingYet() {
  return (
    <div className="grid justify-items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-semibold text-navy-900">Nothing on sale here right now.</p>
      <ResaleSearch className="w-full max-w-xl" />
      <Link href="/listings" className="font-semibold text-brand-700 hover:underline">
        See everything
      </Link>
    </div>
  );
}
