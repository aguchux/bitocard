// Mobile first: no udozo.com or store page is ever wider than the phone it is on (the page wagged left and right when a
// line of the header or a card asked for more than the screen). The base rules and the pieces that caused it.
import "./request";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const { ListingRow } = await import("@/components/listing-card");

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const base = css.slice(css.indexOf("@layer base"));

describe("the base rules", () => {
  it("never lets the page scroll sideways, on <html> where the viewport follows it", () => {
    expect(base).toMatch(/html \{ overflow-x: clip; \}/);
    expect(base).toMatch(/body \{[^}]*overflow-wrap: break-word;/);
  });

  it("lets grid items and fields shrink below their content", () => {
    expect(base).toContain(".grid > * { min-width: 0; }");
    expect(base).toContain(":where(input, select, textarea) { min-width: 0; max-width: 100%; }");
  });
});

describe("a results row", () => {
  it("keeps its one-line highlights from widening the card", () => {
    const card = {
      id: "l1",
      ref: "100027",
      slug: "alienware",
      country: "NG",
      title: "Alienware 17 R5 (AW17R5-7811BLK-PUS)",
      price: { kind: "fixed", amount: 90000000, currency: "NGN" },
      condition: "used",
      cover: null,
      has_video: false,
      highlights: ["Intel Core i9-8950HK", "32GB DDR4", "1TB NVMe SSD", "GeForce GTX 1080 8GB"],
      area: { name: "Ikeja", state: { name: "Lagos" } },
      published_at: "2026-10-30T10:00:00.000Z",
      seller: { badges: [] },
    } as never;
    const html = renderToStaticMarkup(createElement(ListingRow, { card, now: Date.parse("2026-11-01T10:00:00.000Z") }));
    expect(html).toMatch(/<span class="flex min-w-0 flex-1 flex-col gap-1 contain-inline-size">/);
  });
});

describe("a store's header", () => {
  it("uses short words on phones, so the store's name keeps its room", () => {
    const layout = readFileSync(new URL("../app/store/[store]/layout.tsx", import.meta.url), "utf8");
    expect(layout).toContain('Shop<span className="hidden sm:inline">&nbsp;everything</span>');
    expect(layout).toContain('<span className="sm:hidden">Orders</span>');
    expect(layout).toContain('<span className="hidden sm:inline">Your orders</span>');
  });
});
