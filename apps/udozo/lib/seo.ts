import type { Metadata } from "next";
import { conditionLabels, listingPath, type ShopListingCard, type ShopListingPage, type ShopMarket } from "@bitocard/api-client/classifieds";
import type { FaqGroup } from "./help";
import { supportEmail, supportPhone } from "./help";

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
  const brand = brandOf(listing);
  const model = listing.features.find(item => item.key === "model" && typeof item.value === "string" && item.value.trim())?.value;
  // Every feature the seller gave, as people read them (up to 20), besides the condition.
  const properties = [
    ...(listing.condition ? [{ "@type": "PropertyValue", name: "Condition", value: conditionLabels[listing.condition] }] : []),
    ...listing.features.flatMap(feature => (feature.value === null || feature.value === "" ? [] : [{ "@type": "PropertyValue", name: feature.name, value: typeof feature.value === "boolean" ? (feature.value ? "Yes" : "No") : String(feature.value), ...(feature.unit ? { unitText: feature.unit } : {}) }])),
  ].slice(0, 20);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${url}#product`,
    name: listing.title,
    url,
    sku: listing.sku ?? String(listing.ref),
    productID: `udozo:${listing.ref}`,
    ...(listing.photos.length ? { image: listing.photos.slice(0, 6).map(photo => photo.url) } : {}),
    ...(listing.description ? { description: listing.description.replace(/[*_#>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 500) } : {}),
    category: listing.category.parent ? `${listing.category.parent.name} > ${listing.category.name}` : listing.category.name,
    ...(brand ? { brand: { "@type": "Brand", name: brand } } : {}),
    ...(model ? { model } : {}),
    ...(listing.condition ? { itemCondition: itemCondition[listing.condition] } : {}),
    ...(properties.length ? { additionalProperty: properties } : {}),
    ...(offer ? { offers: offer } : {}),
  };
}

/** The make or brand a seller gave (the registry's `brand` or `make` feature), else none: never guessed from the title. */
function brandOf(listing: ShopListingPage) {
  const feature = listing.features.find(item => (item.key === "brand" || item.key === "make") && typeof item.value === "string" && item.value.trim());
  return feature ? String(feature.value).trim() : null;
}

/** The listings a category, place or search page shows, in order, as an ItemList of their pages. */
export function itemListJsonLd(name: string, cards: ShopListingCard[], origin: string, country: string) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: cards.length,
    itemListElement: cards.slice(0, 30).map((card, index) => ({ "@type": "ListItem", position: index + 1, url: new URL(listingPath(country, card.ref, card.slug), origin).href, name: card.title })),
  };
}

/** Udozo as an organisation, with its logo and the support lines it runs (the Contact us page's). */
export function organizationJsonLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: "Udozo",
    url: `${origin}/`,
    logo: { "@type": "ImageObject", url: `${origin}/udozo-logo.png`, width: 512, height: 512 },
    email: supportEmail,
    contactPoint: [
      { "@type": "ContactPoint", contactType: "customer support", email: supportEmail, telephone: supportPhone.e164, availableLanguage: ["en"], url: `${origin}/help/contact` },
    ],
  };
}

/** The site as a whole, published by Udozo. A market's own WebSite adds its search. */
export function websiteJsonLd(origin: string) {
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": `${origin}/#website`, name: "Udozo", url: `${origin}/`, inLanguage: "en", publisher: { "@id": `${origin}/#organization` } };
}

/** The FAQs as FAQPage data, every question with its answer. */
export function faqJsonLd(groups: FaqGroup[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: groups.flatMap(group => group.faqs.map(faq => ({ "@type": "Question", name: faq.q, acceptedAnswer: { "@type": "Answer", text: faq.a } }))),
  };
}

/**
 * Open Graph product tags for a listing (Facebook, Pinterest and WhatsApp's previews): price and currency while it has
 * one, availability and condition.
 */
export function productMetaTags(listing: ShopListingPage): Record<string, string> {
  const tags: Record<string, string> = { "product:availability": listing.status === "sold" ? "out of stock" : "in stock" };
  if (listing.price.kind !== "on_request" && listing.price.amount !== null) {
    tags["product:price:amount"] = schemaPrice(listing.price.amount);
    tags["product:price:currency"] = listing.price.currency;
  }
  if (listing.condition) tags["product:condition"] = listing.condition === "new" ? "new" : "used";
  tags["product:category"] = listing.category.name;
  return tags;
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
