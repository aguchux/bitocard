import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import type { ShopListingCard, ShopListingPage, ShopMarket, ShopSitemap, ShopSitemapListings } from "@bitocard/api-client/classifieds";
import { faqGroups } from "@/lib/help";
import { ogClip, ogMoney, ogPhoto, photoType } from "@/lib/og";
import { breadcrumbJsonLd, faqJsonLd, itemListJsonLd, jsonLdText, listingJsonLd, organizationJsonLd, productMetaTags, regionalAlternates, websiteJsonLd } from "@/lib/seo";
import { countryEntries, listingEntries, sitemapIndex, urlset } from "@/lib/sitemap";

const market = (country: string, name: string): ShopMarket => ({ object: "classified_market", country, name, currency: "NGN", listings: 1, safe_pay: false, install_prompt: false });

const listing: ShopListingPage = {
  object: "classified_listing_page",
  id: "l1",
  ref: 100001,
  sku: "PHN-000042",
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
  test("a country's home, every category, and places and categories in a place with enough listings", () => {
    const page: ShopSitemap = {
      object: "classified_sitemap",
      country: "NG",
      updated_at: "2026-10-25T10:00:00.000Z",
      categories: [
        { slug: "mobile-phones", listings: 3, updated_at: "2026-10-24T10:00:00.000Z" },
        { slug: "boats", listings: 0, updated_at: null },
      ],
      places: [
        { state: "lagos", area: null, listings: 12, updated_at: "2026-10-25T10:00:00.000Z" },
        { state: "lagos", area: "ikeja", listings: 5, updated_at: "2026-10-23T10:00:00.000Z" },
        { state: "kano", area: null, listings: 2, updated_at: "2026-10-22T10:00:00.000Z" },
      ],
      category_places: [
        { state: "lagos", area: null, category: "mobile-phones", listings: 6, updated_at: "2026-10-21T10:00:00.000Z" },
        { state: "lagos", area: "ikeja", category: "mobile-phones", listings: 5, updated_at: "2026-10-21T10:00:00.000Z" },
        { state: "kano", area: null, category: "mobile-phones", listings: 4, updated_at: "2026-10-21T10:00:00.000Z" },
      ],
      listing_pages: [],
    };
    const entries = countryEntries("https://shop.bitocard.com", "ng", page);
    expect(entries.map(entry => entry.loc)).toEqual(["https://shop.bitocard.com/ng", "https://shop.bitocard.com/ng/c/mobile-phones", "https://shop.bitocard.com/ng/c/boats", "https://shop.bitocard.com/ng/lagos", "https://shop.bitocard.com/ng/lagos/ikeja", "https://shop.bitocard.com/ng/lagos/mobile-phones", "https://shop.bitocard.com/ng/lagos/ikeja/mobile-phones"]);
    expect(entries[0]!.lastmod).toBe("2026-10-25T10:00:00.000Z");
    expect(entries[1]!.lastmod).toBe("2026-10-24T10:00:00.000Z");
    const file: ShopSitemapListings = { object: "classified_sitemap_listings", country: "NG", listings: [{ ref: 100001, slug: "tv", updated_at: "2026-10-25T10:00:00.000Z" }], next_after: null };
    expect(listingEntries("https://shop.bitocard.com", "ng", file).map(entry => entry.loc)).toEqual(["https://shop.bitocard.com/ng/l/100001-tv"]);
    expect(urlset([{ loc: "https://shop.bitocard.com/a?b=1&c=2", lastmod: "2026-10-25" }])).toContain("<loc>https://shop.bitocard.com/a?b=1&amp;c=2</loc><lastmod>2026-10-25</lastmod>");
    expect(sitemapIndex(["https://shop.bitocard.com/ng/sitemap.xml"])).toContain("<sitemap><loc>https://shop.bitocard.com/ng/sitemap.xml</loc></sitemap>");
  });
});

describe("commerce listing data", () => {
  const phone: ShopListingPage = {
    ...listing,
    features: [
      { key: "brand", name: "Brand", icon: "tag", unit: null, value: "Apple" },
      { key: "storage", name: "Storage", icon: "hard-drive", unit: "GB", value: 256 },
      { key: "repaired", name: "Ever repaired", icon: "wrench", unit: null, value: false },
      { key: "colour", name: "Colour", icon: "palette", unit: null, value: null },
    ],
  };

  test("the Product names its brand only from the seller's features, its number, condition and every feature", () => {
    const data = listingJsonLd(phone, "https://udozo.com", "ng") as Record<string, unknown>;
    expect(data).toMatchObject({
      "@id": "https://udozo.com/ng/l/100001-iphone-13-pro-256-gb#product",
      sku: "PHN-000042",
      productID: "udozo:100001",
      brand: { "@type": "Brand", name: "Apple" },
      itemCondition: "https://schema.org/UsedCondition",
      category: "Phones & tablets > Mobile phones",
    });
    // Its SKU, else (an ad from before SKUs, with no category) its number.
    expect((listingJsonLd({ ...phone, sku: null }, "https://udozo.com", "ng") as Record<string, unknown>).sku).toBe("100001");
    expect(data.additionalProperty).toEqual([
      { "@type": "PropertyValue", name: "Condition", value: "Used" },
      { "@type": "PropertyValue", name: "Brand", value: "Apple" },
      { "@type": "PropertyValue", name: "Storage", value: "256", unitText: "GB" },
      { "@type": "PropertyValue", name: "Ever repaired", value: "No" },
    ]);
    expect(listingJsonLd(listing, "https://udozo.com", "ng")).not.toHaveProperty("brand");
  });

  test("Open Graph product tags: price and currency, availability and condition", () => {
    expect(productMetaTags(phone)).toEqual({ "product:availability": "in stock", "product:price:amount": "520000.00", "product:price:currency": "NGN", "product:condition": "used", "product:category": "Mobile phones" });
    const sold = productMetaTags({ ...phone, status: "sold", price: { kind: "on_request", amount: null, currency: "NGN" }, condition: "new" });
    expect(sold).toEqual({ "product:availability": "out of stock", "product:condition": "new", "product:category": "Mobile phones" });
  });

  test("category and place pages list their listings; the site names Udozo, its logo and its support lines; the FAQs are FAQPage", () => {
    const card = { ref: 100001, slug: "tv", title: "Hisense TV" } as ShopListingCard;
    expect(itemListJsonLd("TVs for sale in Nigeria", [card], "https://udozo.com", "ng")).toMatchObject({ "@type": "ItemList", numberOfItems: 1, itemListElement: [{ "@type": "ListItem", position: 1, url: "https://udozo.com/ng/l/100001-tv", name: "Hisense TV" }] });
    const org = organizationJsonLd("https://udozo.com");
    expect(org).toMatchObject({ "@type": "Organization", url: "https://udozo.com/", logo: { url: "https://udozo.com/udozo-logo.png" }, email: "support@udozo.com" });
    expect(org.contactPoint[0]).toMatchObject({ telephone: "+447503040682", email: "support@udozo.com" });
    expect(websiteJsonLd("https://udozo.com").publisher).toEqual({ "@id": "https://udozo.com/#organization" });
    const faqs = faqJsonLd(faqGroups);
    expect(faqs.mainEntity).toHaveLength(faqGroups.reduce((sum, group) => sum + group.faqs.length, 0));
    expect(faqs.mainEntity[0]).toMatchObject({ "@type": "Question", acceptedAnswer: { "@type": "Answer" } });
  });

  test("listings in the sitemap carry their photos (https only, at most five) under Google's image extension", () => {
    const page: ShopSitemapListings = { object: "classified_sitemap_listings", country: "NG", listings: [{ ref: 7, slug: "tv", title: "TV", updated_at: "2026-11-01T00:00:00.000Z", images: ["https://media.test/a.jpg?x=1&y=2", "http://insecure.test/b.jpg"] }], next_after: null };
    const xml = urlset(listingEntries("https://udozo.com", "ng", page));
    expect(xml).toContain('xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"');
    expect(xml).toContain("<url><loc>https://udozo.com/ng/l/7-tv</loc><lastmod>2026-11-01T00:00:00.000Z</lastmod><image:image><image:loc>https://media.test/a.jpg?x=1&amp;y=2</image:loc></image:image></url>");
    expect(xml).not.toContain("insecure.test");
    expect(urlset([{ loc: "https://udozo.com/x", images: Array.from({ length: 8 }, (_, i) => `https://media.test/${i}.jpg`) }]).match(/<image:image>/g)).toHaveLength(5);
  });
});

describe("social preview cards", () => {
  test("money by its code (Inter has no ₦ or ₵), text clipped at a word, and only JPEG and PNG photos drawn", () => {
    expect(ogMoney(25000000, "NGN")).toBe("NGN 250,000");
    expect(ogMoney(123456, "GHS")).toBe("GHS 1,234.56");
    expect(ogClip("Samsung Galaxy A54 with box and charger", 24)).toBe("Samsung Galaxy A54…");
    expect(ogClip("Short", 24)).toBe("Short");
    expect(photoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(photoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe("image/png");
    expect(photoType(new TextEncoder().encode("RIFF....WEBP"))).toBeNull();
  });

  test("a photo that cannot be read, or is not https, leaves the card without it", async () => {
    expect(await ogPhoto("http://media.test/a.jpg")).toBeNull();
    expect(await ogPhoto(null)).toBeNull();
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await ogPhoto("https://media.test/a.jpg")).toMatch(/^data:image\/jpeg;base64,/);
    fetchMock.mockImplementationOnce(async () => new Response("nope", { status: 404 }));
    expect(await ogPhoto("https://media.test/b.jpg")).toBeNull();
    vi.unstubAllGlobals();
  });

  test("every listing, category and market page has its own drawn card; the listing's names its photo and price", () => {
    for (const path of ["../app/[cc]/l/[listing]/opengraph-image.tsx", "../app/[cc]/c/[category]/opengraph-image.tsx", "../app/[cc]/opengraph-image.tsx", "../app/opengraph-image.tsx"]) {
      expect(readFileSync(new URL(path, import.meta.url), "utf8"), path).toMatch(/export const size = ogImageSize/);
    }
    const listingPage = readFileSync(new URL("../app/[cc]/l/[listing]/page.tsx", import.meta.url), "utf8");
    expect(listingPage).toContain("other: productMetaTags(listing)");
    expect(listingPage).not.toContain("images: [cover.url]");
  });

  test("the manifest names the language and offers shortcuts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "down" } }, { status: 503 })));
    const { default: manifest } = await import("@/app/manifest");
    const data = await manifest();
    vi.unstubAllGlobals();
    expect(data.lang).toBe("en-GB");
    expect(data.shortcuts?.map(item => item.url)).toEqual(["/sell", "/account/messages", "/account/listings"]);
  });
});
