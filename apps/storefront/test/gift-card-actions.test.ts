import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { GiftCardActions, giftCardCount } from "@/components/app/gift-card-actions";

// Home's Gift cards choice: Buy opens the catalogue's gift cards with how many are on sale; Sell is not built, so it
// says Soon and links nowhere.
const group = (onSale: boolean, products: number) =>
  ({ key: "gift-cards", label: "Gift cards", on_sale: onSale, brands: [], categories: [{ object: "store_category", category: "gift_cards", label: "Gift cards", group: "gift-cards", icon_url: null, image_url: null, products, on_sale: onSale }] }) as unknown as StoreNavigationGroup;
const render = (value: StoreNavigationGroup | undefined) => renderToStaticMarkup(createElement(GiftCardActions, { group: value }));

describe("gift card actions", () => {
  test("buy links to the gift cards with the real count; sell is marked Soon", () => {
    const html = render(group(true, 3631));
    expect(html).toContain('href="/account/catalog?group=gift-cards"');
    expect(html).toContain("3,631 local and international gift cards");
    expect(html).toMatch(/Sell gift cards<\/span><span[^>]*>Soon/);
    expect(html.match(/<a /g)).toHaveLength(1);
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
