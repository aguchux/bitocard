"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowRight, ChevronDown, Globe2, MapPin } from "lucide-react";
import { CategoryMenu, type MenuCategory } from "./category-menu";
import { countryMenuId, openCountryMenu } from "./country-menu";
import { Flag } from "./flag";
import { SearchBar } from "./search-bar";
import { useSearchPlace } from "./search-scope";

/** Where a page with no country (the global showcase) sends the bar: the signed-in customer's own market, if open. */
export type ContinueTo = { country: string; name: string } | null;

type Props = { country: string | null; categories: MenuCategory[]; prefix: string; allHref: string; place: string | null; continueTo?: ContinueTo };

/**
 * The header's one bar: the Categories menu as its navy left end, the search filling the rest, so the two read as a
 * single control, and **Near me** at its far right (its pin alone on phones) choosing the buyer's area (listings near them first). Without a country (the global page) there is nothing to search yet, so the rest of the bar takes the
 * shopper to a market: "Continue to <their country>" when signed in with one, else "Choose your country", which opens
 * the header's country menu.
 */
export function SearchBlend({ country, categories, prefix, allHref, place, continueTo = null, q = "", area, state, autoFocus, searching = false }: Props & { q?: string; area?: string | null; state?: string | null; autoFocus?: boolean; searching?: boolean }) {
  const menu = <CategoryMenu categories={categories} prefix={prefix} allHref={allHref} place={place} />;
  const bar = "flex h-12 min-w-0 items-stretch rounded-2xl border-2 border-navy-900 bg-white";
  const half = "flex min-w-0 flex-1 items-center gap-2.5 rounded-r-2xl px-3 text-[15px] font-bold text-navy-900 hover:bg-navy-50";
  if (!country) {
    return (
      <div className={bar}>
        {menu}
        {continueTo ? (
          <Link href={`/${continueTo.country.toLowerCase()}`} className={half}>
            <Flag country={continueTo.country} />
            <span className="truncate">Continue to {continueTo.name}</span>
            <ArrowRight className="ml-auto size-5 shrink-0" aria-hidden="true" />
          </Link>
        ) : (
          <a
            href={`#${countryMenuId}`}
            onClick={event => {
              if (openCountryMenu()) event.preventDefault();
            }}
            className={half}
          >
            <Globe2 className="size-5 shrink-0 text-navy-600" aria-hidden="true" />
            <span className="truncate">Choose your country</span>
            <ChevronDown className="ml-auto size-5 shrink-0" aria-hidden="true" />
          </a>
        )}
      </div>
    );
  }
  const cc = country.toLowerCase();
  // From the search page, choosing an area goes back to the same search; elsewhere to the area's own page.
  const back = searching ? `?next=${encodeURIComponent(`/${cc}/search${q ? `?q=${encodeURIComponent(q)}` : ""}`)}` : "";
  return (
    <div className={`${bar} focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-500/30`}>
      {menu}
      {/* A new query (another page's) starts the field again. */}
      <SearchBar key={q} country={country} q={q} area={area} state={state} autoFocus={autoFocus} blended />
      <Link
        href={`/${cc}/areas${back}`}
        aria-label={area || state ? "Near me: change your area" : "Near me: choose your area"}
        className="flex w-12 shrink-0 items-center justify-center gap-1.5 rounded-r-2xl border-l border-navy-200 text-sm font-bold text-navy-900 hover:bg-navy-50 sm:w-auto sm:px-3"
      >
        <MapPin className="size-5 text-brand-700 sm:size-4.5" aria-hidden="true" />
        {/* The pin alone on phones, so the field keeps its room; its name is the link's label. */}
        <span className="hidden sm:inline">Near me</span>
      </Link>
    </div>
  );
}

/** The bar with the page's own search: its words, area and state from the address, or a location page's place. */
export function HeaderSearch(props: Props) {
  const params = useSearchParams();
  const path = usePathname();
  const scope = useSearchPlace();
  const q = params.get("q") ?? "";
  const searching = Boolean(props.country) && path === `/${props.country!.toLowerCase()}/search`;
  return <SearchBlend {...props} q={q} area={scope.area ?? params.get("area")} state={scope.state ?? params.get("state")} autoFocus={searching && !q} searching={searching} />;
}
