import { describe, expect, test } from "vitest";
import { featureFilter, filterCount, filtersHref, isFiltered, perPage, readFilters, searchQuery } from "@/lib/search";
import { areaHref, findCategory, findPlace, nearestArea } from "@/lib/places";
import { buyButton } from "@/lib/buy";
import type { ShopState, ShopTopCategory } from "@bitocard/api-client/classifieds";

describe("filters from the address", () => {
  test("words, prices in naira, conditions, feature filters, sort and page; anything malformed is dropped", () => {
    const filters = readFilters({ q: "  iphone 13 ", min: "100,000", max: "600000", condition: ["used,new", "broken"], f: ["storage:128..256", "bad filter", "brand:apple,samsung"], sort: "price_asc", page: "3", area: "ikeja", state: "lagos" });
    expect(filters).toEqual({ q: "iphone 13", priceMin: 100000, priceMax: 600000, condition: ["used", "new"], features: ["storage:128..256", "brand:apple,samsung"], sort: "price_asc", page: 3, area: "ikeja", state: "lagos" });
    expect(readFilters({ min: "-5", sort: "cheapest", page: "100000", area: "Ikeja!" })).toMatchObject({ priceMin: null, sort: null, page: 1, area: null });
  });

  test("the filters form's own fields become the API's feature filters, once per key", () => {
    const filters = readFilters({ "f.storage.min": "64", "f.storage.max": "", "f.brand": ["Apple", "Samsung"], "f.dual_sim": "yes", "f.colour": "black, white", "f.evil:x": "1", f: "brand:tecno" });
    expect(filters.features).toEqual(["brand:tecno", "storage:64..", "dual_sim:yes", "colour:black,white"]);
    expect(featureFilter(filters, "storage")).toEqual({ min: "64", max: null, values: [] });
    expect(featureFilter(filters, "colour")).toEqual({ min: null, max: null, values: ["black", "white"] });
    expect(featureFilter(filters, "memory")).toBeNull();
    expect(filterCount(filters)).toBe(4);
  });

  test("indexed only as a plain page: words, filters, a sort, a later page or a chosen area make it a search", () => {
    expect(isFiltered(readFilters({}))).toBe(false);
    for (const params of [{ q: "tv" }, { min: "5" }, { sort: "newest" }, { page: "2" }, { area: "ikeja", state: "lagos" }]) expect(isFiltered(readFilters(params)), JSON.stringify(params)).toBe(true);
  });
});

describe("the API's search", () => {
  test("prices in kobo, the page's category and place, and the page as an offset", () => {
    const filters = readFilters({ q: "iphone", min: "100000", condition: "used", f: ["storage:128.."], page: "2", area: "ikeja", state: "lagos" });
    const path = searchQuery("ng", filters, { category: "mobile-phones" });
    const params = new URL(path, "https://api.test").searchParams;
    expect(path.startsWith("/v1/classifieds/listings?")).toBe(true);
    expect(Object.fromEntries(params)).toMatchObject({ country: "NG", q: "iphone", category: "mobile-phones", area: "ikeja", state: "lagos", price_min: "10000000", condition: "used", offset: String(perPage), limit: String(perPage) });
    expect(params.getAll("f")).toEqual(["storage:128.."]);
    // A location page's own place wins; a state page does not keep an area from the address.
    const state = new URL(searchQuery("ng", filters, { state: "kano" }), "https://api.test").searchParams;
    expect([state.get("state"), state.get("area")]).toEqual(["kano", null]);
  });

  test("links to the same page with filters changed go back to the first page", () => {
    const filters = readFilters({ q: "tv", page: "4", condition: "new" });
    expect(filtersHref("/ng/c/tvs", filters, { sort: "price_desc" })).toBe("/ng/c/tvs?q=tv&condition=new&sort=price_desc");
    expect(filtersHref("/ng/c/tvs", filters, { page: 5 })).toBe("/ng/c/tvs?q=tv&condition=new&page=5");
    expect(filtersHref("/ng/c/tvs", readFilters({}))).toBe("/ng/c/tvs");
  });
});

const states: ShopState[] = [
  {
    object: "classified_area",
    id: "s1",
    slug: "lagos",
    name: "Lagos",
    kind: "state",
    latitude: 6.52,
    longitude: 3.37,
    areas: [
      { object: "classified_area", id: "a1", slug: "ikeja", name: "Ikeja", kind: "area", latitude: 6.6018, longitude: 3.3515 },
      { object: "classified_area", id: "a2", slug: "lekki", name: "Lekki", kind: "area", latitude: 6.4698, longitude: 3.5852 },
    ],
  },
  { object: "classified_area", id: "s2", slug: "kano", name: "Kano", kind: "state", latitude: 12, longitude: 8.52, areas: [{ object: "classified_area", id: "a3", slug: "kano", name: "Kano", kind: "area", latitude: 12, longitude: 8.52 }] },
];

const category = (slug: string, children: string[] = []): ShopTopCategory => ({
  object: "classified_category",
  id: slug,
  slug,
  name: slug,
  icon: "tag",
  b2b: false,
  safety_checklist: [],
  features: [],
  children: children.map(child => ({ object: "classified_category", id: child, slug: child, name: child, icon: "tag", b2b: false, safety_checklist: [], features: [] })),
});

describe("places and categories", () => {
  test("a category or subcategory by slug; a state and its areas", () => {
    const categories = [category("phones-tablets", ["mobile-phones", "tablets"]), category("vehicles")];
    expect(findCategory(categories, "phones-tablets")?.children.map(child => child.slug)).toEqual(["mobile-phones", "tablets"]);
    expect(findCategory(categories, "tablets")).toMatchObject({ category: { slug: "tablets" }, top: { slug: "phones-tablets" }, children: [] });
    expect(findCategory(categories, "boats")).toBeNull();
    expect(findPlace(states, "lagos", "lekki")?.area?.name).toBe("Lekki");
    expect(findPlace(states, "lagos")?.area).toBeNull();
    expect(findPlace(states, "lagos", "kano")).toBeNull();
  });

  test("the nearest area to a position, and where choosing one goes", () => {
    expect(nearestArea(states, 6.6, 3.34)?.area.slug).toBe("ikeja");
    expect(nearestArea(states, 11.9, 8.5)?.area.slug).toBe("kano");
    expect(areaHref("NG", "lagos", "ikeja", null)).toBe("/ng/lagos/ikeja");
    expect(areaHref("NG", "lagos", null, null)).toBe("/ng/lagos");
    expect(areaHref("NG", "lagos", "ikeja", "/ng/search?q=tv&area=kano&page=3")).toBe("/ng/search?q=tv&state=lagos&area=ikeja");
  });
});

describe("Buy with Safe pay", () => {
  const listing = { status: "active" as const, reserved: false, price: { kind: "fixed" as const, amount: 52000000, currency: "NGN" } };
  const viewer = { object: "classified_listing_viewer" as const, listing_id: "l1", own: false, favourite: false, conversation_id: null, order: null, can_contact: true };
  test("offered on live listings with a price; continues an open order; never on one's own, reserved or sold ones", () => {
    expect(buyButton(listing, null, "/ng/l/1/buy", true)).toEqual({ href: "/ng/l/1/buy", label: "Buy with Safe pay" });
    expect(buyButton(listing, { ...viewer, order: { id: "o1", number: "SP-100001", status: "awaiting_payment" } }, "/b", true)?.label).toBe("Continue Safe pay order SP-100001");
    expect(buyButton({ ...listing, reserved: true }, { ...viewer, order: { id: "o1", number: "SP-100001", status: "paid" } }, "/b", true)?.label).toMatch(/Continue/);
    expect(buyButton(listing, { ...viewer, own: true }, "/b", true)).toBeNull();
    expect(buyButton({ ...listing, reserved: true }, viewer, "/b", true)).toBeNull();
    expect(buyButton({ ...listing, status: "sold" }, viewer, "/b", true)).toBeNull();
    expect(buyButton({ ...listing, price: { kind: "on_request", amount: null, currency: "NGN" } }, viewer, "/b", true)).toBeNull();
    expect(buyButton(listing, viewer, "/b", false)).toBeNull();
    expect(buyButton(listing, { ...viewer, order: { id: "o1", number: "SP-100001", status: "paid" } }, "/b", false)?.label, "an open order continues whatever").toMatch(/Continue/);
  });
});
