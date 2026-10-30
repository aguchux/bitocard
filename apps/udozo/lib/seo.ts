import type { Metadata } from "next";
import { conditionLabels, listingPath, type ShopListingPage, type ShopMarket } from "@bitocard/api-client/classifieds";

/**
 * hreflang between true regional versions only: the same page in each open country (`/ng/c/phones`, `/gh/c/phones` as
 * en-NG and en-GH), with the global page as x-default once the showcase is on. Never on listings, which are unique.
 */
export function regionalAlternates(markets: ShopMarket[], showcase: boolean, path: (cc: string) => string, global: string | null): NonNullable<Metadata["alternates"]>["languages"] {
  if (!showcase || markets.length < 2) return undefined;
  return {
    ...Object.fromEntries(markets.map(market => [`en-${market.country}`, path(market.country.toLowerCase())])),
    ...(global ? { "x-default": global } : {}),
  };
}

/** Search results and filtered views: not indexed, but their links are followed. */
export const noindexFollow: Metadata["robots"] = { index: false, follow: true };

/** The price in the currency's main unit as schema.org wants it ("520000.00"). */
const schemaPrice = (minor: number) => (minor / 100).toFixed(2);

const itemCondition = { new: "https://schema.org/NewCondition", used: "https://schema.org/UsedCondition", untested: "https://schema.org/UsedCondition", parts: "https://schema.org/DamagedCondition" } as const;

/**
 * Product and Offer JSON-LD for a listing's page (only country pages carry a price). A sold listing keeps the product
 * but no offer; a listing without a price has no offer either.
 */
export function listingJsonLd(listing: ShopListingPage, origin: string, country: string) {
  const url = new URL(listingPath(country, listing.ref, listing.slug), origin).href;
  const offer =
    listing.status === "active" && listing.price.kind !== "on_request" && listing.price.amount !== null
      ? {
          "@type": "Offer",
          url,
          price: schemaPrice(listing.price.amount),
          priceCurrency: listing.price.currency,
          availability: listing.reserved ? "https://schema.org/LimitedAvailability" : "https://schema.org/InStock",
          ...(listing.condition ? { itemCondition: itemCondition[listing.condition] } : {}),
          areaServed: { "@type": "Place", name: `${listing.area.name}, ${listing.area.state.name}` },
          seller: { "@type": "Person", name: listing.seller.name },
        }
      : null;
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    url,
    ...(listing.photos.length ? { image: listing.photos.slice(0, 6).map(photo => photo.url) } : {}),
    ...(listing.description ? { description: listing.description.replace(/[*_]/g, "").slice(0, 500) } : {}),
    category: listing.category.name,
    ...(listing.condition ? { additionalProperty: [{ "@type": "PropertyValue", name: "Condition", value: conditionLabels[listing.condition] }] } : {}),
    ...(offer ? { offers: offer } : {}),
  };
}

/** Breadcrumb JSON-LD from the trail a page shows. */
export function breadcrumbJsonLd(trail: { name: string; path: string }[], origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: new URL(item.path, origin).href })),
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so text can never close the script. */
export function jsonLdText(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
