import { describe, expect, test } from "vitest";
import type { ShopListingPage, ShopMarket, ShopSitemap } from "@bitocard/api-client/classifieds";
import { breadcrumbJsonLd, jsonLdText, listingJsonLd, regionalAlternates } from "@/lib/seo";
import { countryEntries, sitemapIndex, urlset } from "@/lib/sitemap";

const market = (country: string, name: string): ShopMarket => ({ object: "classified_market", country, name, currency: "NGN", listings: 1, safe_pay: false });

const listing: ShopListingPage = {
  object: "classified_listing_page",
  id: "l1",
  ref: 100001,
  status: "active",
  title: "iPhone 13 Pro, 256 GB",
  slug: "iphone-13-pro-256-gb",
  url: "https://shop.bitocard.com/ng/l/100001-iphone-13-pro-256-gb",
  description: "Clean phone, **never repaired**.",
  price: { kind: "negotiable", amount: 52000000, currency: "NGN" },
  condition: "used",
  category: { slug: "mobile-phones", name: "Mobile phones", parent: { slug: "phones-tablets", name: "Phones & tablets" }, safety_checklist: [] },
  area: { slug: "ikeja", name: "Ikeja", state: { slug: "lagos", name: "Lagos" } },
  features: [],
  photos: [{ url: "https://media.test/1.jpg", width: 1600, height: 1200 }],
  video: null,
  delivery: "none",
  reserved: false,
  contact: { chat: true, phone: false },
  seller: { name: "Chinedu O.", member_since: "2026-03-01T00:00:00Z", badges: [], active_listings: 3, response_rate: null },
  published_at: "2026-10-25T10:00:00Z",
  sold_at: null,
};

describe("hreflang", () => {
  test("only between countries, with the global page as x-default, once the showcase is on", () => {
    const both = [market("NG", "Nigeria"), market("GH", "Ghana")];
    expect(regionalAlternates(both, true, cc => `/${cc}/c/phones`, "/c/phones")).toEqual({ "en-NG": "/ng/c/phones", "en-GH": "/gh/c/phones", "x-default": "/c/phones" });
    expect(regionalAlternates(both, false, cc => `/${cc}`, "/")).toBeUndefined();
    expect(regionalAlternates([market("NG", "Nigeria")], true, cc => `/${cc}`, "/")).toBeUndefined();
  });
});

describe("structured data", () => {
  test("a live listing's Product with its Offer in naira; sold ones and those without a price have no offer", () => {
    const data = listingJsonLd(listing, "https://shop.bitocard.com", "ng") as Record<string, unknown> & { offers?: Record<string, unknown> };
    expect(data).toMatchObject({ "@type": "Product", name: listing.title, url: listing.url, image: ["https://media.test/1.jpg"], description: "Clean phone, never repaired." });
    expect(data.offers).toMatchObject({ "@type": "Offer", price: "520000.00", priceCurrency: "NGN", availability: "https://schema.org/InStock", itemCondition: "https://schema.org/UsedCondition" });
    expect(listingJsonLd({ ...listing, status: "sold" }, "https://shop.bitocard.com", "ng")).not.toHaveProperty("offers");
    expect(listingJsonLd({ ...listing, price: { kind: "on_request", amount: null, currency: "NGN" } }, "https://shop.bitocard.com", "ng")).not.toHaveProperty("offers");
    expect(breadcrumbJsonLd([{ name: "Nigeria", path: "/ng" }], "https://shop.bitocard.com").itemListElement[0]).toEqual({ "@type": "ListItem", position: 1, name: "Nigeria", item: "https://shop.bitocard.com/ng" });
    expect(jsonLdText({ title: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});

describe("sitemaps", () => {
  test("a country's home, categories with listings, places with enough of them, and every listing", () => {
    const page: ShopSitemap = {
      object: "classified_sitemap",
      country: "NG",
      categories: [
        { slug: "mobile-phones", listings: 3 },
        { slug: "boats", listings: 0 },
      ],
      places: [
        { state: "lagos", area: null, listings: 12 },
        { state: "lagos", area: "ikeja", listings: 5 },
        { state: "kano", area: null, listings: 2 },
      ],
      listings: [{ ref: 100001, slug: "tv", updated_at: "2026-10-25T10:00:00.000Z" }],
      next_after: null,
    };
    const locations = countryEntries("https://shop.bitocard.com", "ng", [page]).map(entry => entry.loc);
    expect(locations).toEqual(["https://shop.bitocard.com/ng", "https://shop.bitocard.com/ng/c/mobile-phones", "https://shop.bitocard.com/ng/lagos", "https://shop.bitocard.com/ng/lagos/ikeja", "https://shop.bitocard.com/ng/l/100001-tv"]);
    expect(urlset([{ loc: "https://shop.bitocard.com/a?b=1&c=2", lastmod: "2026-10-25" }])).toContain("<loc>https://shop.bitocard.com/a?b=1&amp;c=2</loc><lastmod>2026-10-25</lastmod>");
    expect(sitemapIndex(["https://shop.bitocard.com/ng/sitemap.xml"])).toContain("<sitemap><loc>https://shop.bitocard.com/ng/sitemap.xml</loc></sitemap>");
  });
});
