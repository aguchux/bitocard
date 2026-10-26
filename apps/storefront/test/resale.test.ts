import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ResaleStoreListing, ResolvedSection, StoreDesign } from "@bitocard/api-client/storefront";
import { HomeSections } from "@/components/store/sections";
import { ResaleCard } from "@/components/store/resale";
import { deliveryText, listingRef, resaleListingPath, resaleSupplierPath } from "@/lib/resale-links";

const item = (id: string, extra: Partial<ResaleStoreListing> = {}): ResaleStoreListing => ({
  object: "resale_store_listing",
  id,
  ref: 104233,
  slug: "hisense-50-inch-tv",
  title: "Hisense 50 inch TV",
  cover: { url: "https://media.test/1.jpg", width: 1600, height: 1200 },
  photo_count: 4,
  currency: "NGN",
  price: 28750000,
  condition: "new",
  category: { slug: "tvs", name: "TVs" },
  area: { name: "Gwarinpa", state: "Abuja (FCT)" },
  delivery: "state",
  available: 3,
  note: null,
  supplier: { id: "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f", name: "Chinedu O.", member_since: "2026-06-02T10:00:00.000Z", badges: ["id_checked"] },
  ...extra,
});

const colors = { primary: "#e11d48", accent: "#070f4c", background: "#fafafa", surface: "#ffffff", ink: "#111827", muted: "#6b7280", heroFrom: "#111827", heroTo: "#1f2937", heroInk: "#ffffff" };
const designs: StoreDesign[] = [
  { template: "resale_shop", variant: "showroom", theme: "ink_coral", style: { mode: "light", hero: "showroom", corners: "round", cards: "raised", font: "display", density: "comfortable" }, colors },
  { template: "resale_shop", variant: "shelf", theme: "linen", style: { mode: "light", hero: "shelf", corners: "soft", cards: "outline", font: "serif", density: "airy" }, colors },
  { template: "resale_shop", variant: "aisle", theme: "night_market", style: { mode: "dark", hero: "aisle", corners: "sharp", cards: "flat", font: "sans", density: "compact" }, colors },
];

const span = { lg: 12 as const, md: 6 as const, rows: 1 as const };
const sections = (listings: ResaleStoreListing[]): ResolvedSection[] => [
  { id: "h", type: "hero", span, hidden: false, title: "Quality items,", accent: "checked sellers.", subtitle: "", search: true, categoryChips: true, data: { featured: [], listings, categories: [{ slug: "tvs", name: "TVs", count: 2, cover: null }] } },
  { id: "r", type: "listing_rail", span, hidden: false, title: "Just in", subtitle: "", source: "newest", limit: 8, data: { listings, total: listings.length } },
  { id: "g", type: "listing_grid", span, hidden: false, title: "Everything", subtitle: "", sort: "newest", limit: 12, data: { listings, total: 30 } },
  { id: "c", type: "resale_categories", span, hidden: false, title: "Shop by category", subtitle: "", limit: 8, data: { categories: [{ slug: "tvs", name: "TVs", count: 2, cover: null }] } },
];

describe("Resale shops", () => {
  test("every design names the supplier on every listing, linking to their page with the listing", () => {
    const listings = [item("a"), item("b", { ref: 104234, slug: "sony-tv", title: "Sony TV" })];
    for (const design of designs) {
      const html = renderToStaticMarkup(createElement(HomeSections, { sections: sections(listings), groups: [], countries: [], design }));
      // The rail and the grid each show both listings, each with its supplier line.
      expect(html.match(/data-supplier-line/g)?.length, design.variant).toBe(4);
      expect(html).toContain(`href="/suppliers/${listings[0].supplier.id}?listing=104233"`);
      expect(html).toContain("Supplied by");
      expect(html).toContain('href="/listings?category=tvs"');
      expect(html).toContain("₦287,500");
    }
  });

  test("a card shows only an approved note (the API sends no other), stock running out, and the supplier", () => {
    const html = renderToStaticMarkup(createElement(ResaleCard, { item: item("a", { note: "Free wall bracket.", available: 1 }) }));
    expect(html).toContain("Free wall bracket.");
    expect(html).toContain("Last one");
    expect(html).toContain("ID checked");
    expect(html).toContain('href="/l/104233-hisense-50-inch-tv"');
  });

  test("addresses", () => {
    expect(resaleListingPath({ ref: 5, slug: "tv" })).toBe("/l/5-tv");
    expect(resaleSupplierPath("x", 5)).toBe("/suppliers/x?listing=5");
    expect([listingRef("5-tv"), listingRef("5"), listingRef("tv"), listingRef("5-<x>")]).toEqual([5, 5, null, null]);
    expect(deliveryText("none", { name: "Gwarinpa", state: "Abuja (FCT)" })).toBe("Meet-up in Gwarinpa");
    expect(deliveryText("state", { name: "Gwarinpa", state: "Abuja (FCT)" })).toBe("Delivery within Abuja (FCT)");
  });
});
