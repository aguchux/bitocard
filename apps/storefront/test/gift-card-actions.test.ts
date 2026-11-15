import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { GiftCardActions, giftCardCount } from "@/components/app/gift-card-actions";
import { ProductCard } from "@/components/store/product-card";

// Home's Gift cards choice: Buy opens the catalogue's gift cards with how many are on sale; Sell opens them too where
// selling is open in the customer's country (they sell from a card's page), and says Soon, linking nowhere, elsewhere.
const group = (onSale: boolean, products: number) =>
  ({ key: "gift-cards", label: "Gift cards", on_sale: onSale, brands: [], categories: [{ object: "store_category", category: "gift_cards", label: "Gift cards", group: "gift-cards", icon_url: null, image_url: null, products, on_sale: onSale }] }) as unknown as StoreNavigationGroup;
const render = (value: StoreNavigationGroup | undefined, sellOpen = false) => renderToStaticMarkup(createElement(GiftCardActions, { group: value, sellOpen }));

describe("gift card actions", () => {
  test("buy links to the gift cards with the real count; sell is marked Soon", () => {
    const html = render(group(true, 3631));
    expect(html).toContain('href="/account/catalog?group=gift-cards"');
    expect(html).toContain("3,631 local and international gift cards");
    expect(html).toMatch(/Sell gift cards<\/span><span[^>]*>Soon/);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  test("where selling is open, Sell opens the gift cards to choose one (each on its Sell tab), with no Soon", () => {
    const html = render(group(true, 3631), true);
    expect(html).toContain('href="/account/catalog?group=gift-cards"');
    expect(html).toContain('href="/account/catalog?group=gift-cards&amp;sell=1"');
    expect(html).not.toContain(">Soon<");
    expect(html).toContain("once the card is accepted");
  });

  test("nothing on sale: neither card links anywhere", () => {
    for (const value of [group(false, 0), undefined]) {
      const html = render(value);
      expect(html).not.toContain("<a ");
      expect(html.match(/>Soon</g)).toHaveLength(2);
    }
    expect(giftCardCount(undefined)).toBe(0);
  });
});

test("a product card can open its page on Sell", () => {
  const product = { key: "gift_cards:US:amazon-us", name: "Amazon US", description: null, category_label: "Gift cards", global: false, country_name: "United States", brand: { slug: "amazon", name: "Amazon", initials: "A", color: null, logo_url: null, image_url: null }, from: 1000, to: 1000, currency: "USD", price: null } as never;
  const html = renderToStaticMarkup(createElement(ProductCard, { product, base: "/account/p", search: "?sell=1" }));
  expect(html).toContain('href="/account/p/gift_cards%3AUS%3Aamazon-us?sell=1"');
});
