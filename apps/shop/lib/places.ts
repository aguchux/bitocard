import { placePath, type ShopCategory, type ShopState, type ShopTopCategory } from "@bitocard/api-client/classifieds";

/** A category by its slug, with its top category when it is a subcategory. */
export function findCategory(categories: ShopTopCategory[], slug: string): { category: ShopCategory; top: ShopTopCategory; children: ShopCategory[] } | null {
  for (const top of categories) {
    if (top.slug === slug) return { category: top, top, children: top.children };
    const child = top.children.find(item => item.slug === slug);
    if (child) return { category: child, top, children: [] };
  }
  return null;
}

/** A state by its slug, and optionally one of its areas. */
export function findPlace(states: ShopState[], state: string, area?: string | null) {
  const found = states.find(item => item.slug === state);
  if (!found) return null;
  if (!area) return { state: found, area: null };
  const inside = found.areas.find(item => item.slug === area);
  return inside ? { state: found, area: inside } : null;
}

/** The nearest area to a point (the area picker's "Use my location"), by straight-line distance on the map. */
export function nearestArea(states: ShopState[], latitude: number, longitude: number) {
  let best: { state: ShopState; area: ShopState["areas"][number]; km: number } | null = null;
  for (const state of states) {
    for (const area of state.areas) {
      const km = Math.hypot(area.latitude - latitude, (area.longitude - longitude) * Math.cos((latitude * Math.PI) / 180)) * 111.32;
      if (!best || km < best.km) best = { state, area, km };
    }
  }
  return best;
}

/** Where choosing an area goes: back to the search that asked (with the area), else that area's own page. */
export function areaHref(country: string, state: string, area: string | null, next: string | null) {
  if (next) {
    const url = new URL(next, "https://shop.invalid");
    url.searchParams.delete("area");
    url.searchParams.delete("state");
    url.searchParams.delete("page");
    url.searchParams.set("state", state);
    if (area) url.searchParams.set("area", area);
    return `${url.pathname}${url.search}`;
  }
  return placePath(country, { state, area });
}
