// pos.udozo.com's Products (milestone 2): the owner's udozo.com listings ticked Sell at POS, read live from Udozo with
// the filters in the address, what the till can sell, what is low or out, why the rest cannot sell, and, with none yet,
// how to tick them on udozo.com.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PosCatalogue, PosProduct } from "@/lib/pos";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ usePathname: () => "/app/products", useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn() }));

const { blockText, catalogueQuery, stockLine } = await import("@/lib/pos");
const { ownerCatalogue } = await import("@/lib/pos-data");
const { default: ProductsPage } = await import("@/app/app/products/page");

const product = (over: Partial<PosProduct> = {}): PosProduct => ({
  object: "pos_product",
  id: "p1",
  ref: 100_042,
  sku: "TVS-000012",
  title: "Samsung 43 inch smart TV",
  price: { kind: "fixed", amount: 25_000_000, currency: "NGN" },
  barcode: "036000291452",
  category: { id: "c1", name: "TVs and home cinema", parent: { id: "top", name: "Electronics" } },
  photo_url: "https://udozo.test/img/m1.jpg?w=480",
  status: "active",
  stock: 4,
  held: 1,
  available: 3,
  reorder_level: 5,
  low_stock: true,
  on_udozo: true,
  blocked: null,
  ticked_at: "2026-11-11T08:00:00.000Z",
  edit_url: "https://udozo.com/account/listings/p1",
  ...over,
});

const catalogue = (data: PosProduct[], over: Partial<PosCatalogue> = {}): PosCatalogue => ({
  object: "list",
  currency: "NGN",
  plan: { code: "free", name: "Free" },
  shop_kind: { code: "phones_electronics", name: "Phones and electronics" },
  summary: { products: data.length, limit: 50, over_limit: 0, sellable: data.filter(item => !item.blocked).length, low_stock: 1, out_of_stock: 0 },
  categories: [
    { id: "top", name: "Electronics", count: 2, featured: true },
    { id: "home", name: "Home and living", count: 1, featured: false },
  ],
  total: data.length,
  has_more: false,
  data,
  ...over,
});

const sent: string[] = [];
let reply: unknown = catalogue([]);

beforeEach(() => {
  sent.length = 0;
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push(`${init.method ?? "GET"} ${url} ${(init.headers as Record<string, string>)["bitocard-customer-session"] ?? ""}`);
    return Response.json(reply);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const page = async (params: Record<string, string> = {}) => renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve(params) }));

describe("the catalogue's words and filters", () => {
  it("reads the filters from the address, cleaned, as the API takes them", () => {
    expect(catalogueQuery({}).api).toBe("?show=all&limit=24&offset=0");
    const asked = catalogueQuery({ q: "  tv ", show: "low_stock", category: "5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a", page: "3" });
    expect(asked).toMatchObject({ q: "tv", show: "low_stock", page: 3 });
    expect(asked.api).toBe("?show=low_stock&limit=24&offset=48&q=tv&category=5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a");
    expect(catalogueQuery({ show: "everything", category: "../x", page: "-2" }).api).toBe("?show=all&limit=24&offset=0");
  });

  it("says why a product does not sell, and what the till can sell", () => {
    expect(blockText(product({ blocked: "plan_limit" }), "Free")).toMatch(/^Over Free's product limit/);
    expect(blockText(product({ blocked: "incomplete", title: null }), "Free")).toBe("No title yet: finish it on udozo.com to sell it.");
    expect(blockText(product({ blocked: "no_price" }), "Free")).toMatch(/No price/);
    expect(blockText(product(), "Free")).toBeNull();
    expect(stockLine(product())).toBe("3 free to sell (1 held for online buyers)");
    expect(stockLine(product({ held: 0, available: 4 }))).toBe("4 free to sell");
    expect(stockLine(product({ stock: 0, available: 0, held: 0 }))).toBe("Out of stock");
  });
});

describe("Products", () => {
  it("reads the catalogue live from Udozo with the owner's session", async () => {
    reply = catalogue([product()]);
    await ownerCatalogue("?show=all&limit=24&offset=0");
    expect(sent).toEqual(["GET https://api.udozo.test/v1/pos/owner/catalogue?show=all&limit=24&offset=0 bcc_owner"]);
  });

  it("lists each product with its price, stock, barcode and a link to edit it on udozo.com", async () => {
    reply = catalogue([product(), product({ id: "p2", title: "Binatone fan", blocked: "plan_limit", low_stock: false, on_udozo: false, barcode: null })], { summary: { products: 51, limit: 50, over_limit: 1, sellable: 50, low_stock: 1, out_of_stock: 0 } });
    const html = await page({ show: "all" });
    expect(html).toContain("Samsung 43 inch smart TV");
    expect(html).toContain("₦250,000");
    expect(html).toContain("3 free to sell (1 held for online buyers)");
    expect(html).toContain("Barcode 036000291452");
    expect(html).toContain('href="https://udozo.com/account/listings/p1"');
    expect(html).toContain("51 of 50");
    expect(html).toContain("Free sells 50 products at your shop, so 1 is not selling.");
    expect(html).toContain("Over Free&#x27;s product limit");
    expect(html).toContain("Shop only");
    expect(html).toContain("No barcode");
    // The views and categories keep the other filters, and mark the current one.
    expect(html).toContain('href="/app/products?show=low_stock"');
    expect(html).toContain('aria-current="page" class="flex h-10 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap no-underline bg-pos-600 text-white" href="/app/products"');
    expect(html).toContain('href="/app/products?category=top"');
  });

  it("with nothing ticked yet, says how to tick listings on udozo.com", async () => {
    reply = catalogue([], { summary: { products: 0, limit: 50, over_limit: 0, sellable: 0, low_stock: 0, out_of_stock: 0 }, categories: [] });
    const html = await page();
    expect(html).toContain("No products at the till yet");
    expect(html).toContain("Sell at your shop with Udozo POS");
    expect(html).toContain('href="https://udozo.test/account/listings"');
    expect(html).not.toContain('role="search"');
  });

  it("pages through, keeping the filters", async () => {
    reply = catalogue([product()], { total: 60, has_more: true, summary: { products: 60, limit: null, over_limit: 0, sellable: 60, low_stock: 0, out_of_stock: 0 } });
    const html = await page({ q: "tv", page: "2" });
    expect(sent[0]).toContain("offset=24&q=tv");
    expect(html).toContain("Page 2 of 3");
    expect(html).toContain('href="/app/products?q=tv"');
    expect(html).toContain('href="/app/products?q=tv&amp;page=3"');
  });
});
