"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { CategoryMenu, type MenuCategory } from "./category-menu";
import { SearchBar } from "./search-bar";
import { useSearchPlace } from "./search-scope";

type Props = { country: string | null; categories: MenuCategory[]; prefix: string; allHref: string; place: string | null };

/**
 * The header's one bar: the Categories menu as its navy left end, the search filling the rest, so the two read as a
 * single control. Without a country (the global page) there is nothing to search yet, so it is the Categories menu alone.
 */
export function SearchBlend({ country, categories, prefix, allHref, place, q = "", area, state, autoFocus }: Props & { q?: string; area?: string | null; state?: string | null; autoFocus?: boolean }) {
  const menu = <CategoryMenu categories={categories} prefix={prefix} allHref={allHref} place={place} labelled={!country} />;
  if (!country) return <div className="flex h-12 overflow-hidden rounded-2xl border-2 border-navy-900">{menu}</div>;
  return (
    <div className="flex h-12 min-w-0 items-stretch rounded-2xl border-2 border-navy-900 bg-white focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-500/30">
      {menu}
      {/* A new query (another page's) starts the field again. */}
      <SearchBar key={q} country={country} q={q} area={area} state={state} autoFocus={autoFocus} blended />
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
  return <SearchBlend {...props} q={q} area={scope.area ?? params.get("area")} state={scope.state ?? params.get("state")} autoFocus={searching && !q} />;
}
