// pos.udozo.com's till (milestone 3): the basket's totals worked out exactly as Udozo does (so the total sent is the one
// Udozo checks), what a scanner or cashier types, the sale sent with the basket's own id as its idempotency key, the
// sales list and a sale with its refund, and the register drawn with the shop's products.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PosProduct, PosSale, PosSales } from "@/lib/pos";
import { setRequest } from "./request";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/till", useRouter: () => ({ refresh: vi.fn() }), redirect: vi.fn(), notFound: vi.fn() }));

const { cashSuggestions, findProducts, readAmount, salesQuery, shopToday, tillTotals } = await import("@/lib/pos");
const { adjustStock, refundSale, ringUp } = await import("@/lib/pos-actions");
const { Register } = await import("@/components/register");
const { default: SalesPage } = await import("@/app/app/sales/page");
const { default: SalePage } = await import("@/app/app/sales/[id]/page");

const till = "7c6b5a49-3827-4e1d-9c0b-a1b2c3d4e5f6";
const basket = "0f1e2d3c-4b5a-4968-8776-655443322110";
const tv = "5e0d2a1b-9c8f-4d3e-8b7a-6f5e4d3c2b1a";

const product = (over: Partial<PosProduct> = {}): PosProduct => ({
  object: "pos_product",
  id: tv,
  ref: 100_042,
  sku: "TVS-000012",
  title: "Samsung 43 inch smart TV",
  price: { kind: "fixed", amount: 25_000_000, currency: "NGN" },
  barcode: "036000291452",
  category: { id: "c1", name: "TVs and home cinema", parent: { id: "top", name: "Electronics" } },
  photo_url: null,
  status: "active",
  stock: 4,
  held: 1,
  available: 3,
  reorder_level: null,
  low_stock: false,
  on_udozo: true,
  blocked: null,
  ticked_at: "2026-11-11T08:00:00.000Z",
  edit_url: "https://udozo.com/account/listings/p1",
  ...over,
});

const sale = (over: Partial<PosSale> = {}): PosSale => ({
  object: "pos_sale",
  id: "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d",
  number: "POS-000007",
  client_sale_id: basket,
  status: "completed",
  shop: { id: "s1", name: "Ada's Gadget Hub" },
  till: { id: till, name: "Till 1" },
  currency: "NGN",
  items: 2,
  subtotal: 50_000_000,
  discount: 0,
  vat_bps: 750,
  vat: 3_750_000,
  total: 53_750_000,
  change: 1_250_000,
  lines: [{ listing_id: tv, title: "Samsung 43 inch smart TV", sku: "TVS-000012", barcode: null, quantity: 2, unit_price: 25_000_000, discount: 0, total: 50_000_000 }],
  payments: [{ method: "cash", amount: 53_750_000, tendered: 55_000_000, change: 1_250_000, reference: null }],
  sold_by: "Ada Okafor",
  note: null,
  refunded_at: null,
  refund_reason: null,
  restocked: null,
  created_at: "2026-11-11T13:05:00.000Z",
  client_created_at: null,
  ...over,
});

const sent: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
let reply: unknown = {};

beforeEach(() => {
  sent.length = 0;
  setRequest({}, { udz_pos: "bcc_owner" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    sent.push({ method: init.method ?? "GET", url: url.replace("https://api.udozo.test", ""), body: init.body ? JSON.parse(String(init.body)) : undefined, headers: (init.headers ?? {}) as Record<string, string> });
    return Response.json(reply);
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the basket's arithmetic", () => {
  it("works out the total exactly as Udozo does: line discounts, the sale's discount, then VAT rounded half up", () => {
    // The API's own example: 2 × 10,000 less 1,000, a 2,500 fan, 1,000 off the sale, 7.5% VAT.
    expect(tillTotals([{ id: "a", unit: 10_000_00, quantity: 2, discount: 1_000_00 }, { id: "b", unit: 2_500_00, quantity: 1 }], { discount: 1_000_00, vatBps: 750 })).toEqual({ items: 3, subtotal: 22_500_00, discount: 2_000_00, vat: 1_537_50, total: 22_037_50 });
    expect(tillTotals([{ id: "a", unit: 333, quantity: 1 }], { vatBps: 750 }).vat).toBe(25);
    // A discount never takes the sale below nothing.
    expect(tillTotals([{ id: "a", unit: 500, quantity: 1 }], { discount: 900 }).total).toBe(0);
  });

  it("reads amounts as people type them, and offers round notes for cash", () => {
    expect(readAmount("1,500")).toBe(150_000);
    expect(readAmount("₦ 1500.5")).toBe(150_050);
    expect(readAmount("12.345")).toBeNull();
    expect(readAmount("abc")).toBeNull();
    expect(cashSuggestions(2_037_50)).toEqual([2_037_50, 2_100_00, 2_200_00, 2_500_00]);
    expect(cashSuggestions(0)).toEqual([]);
  });

  it("finds a product by what a scanner types first, else by words in its name", () => {
    const list = [product(), product({ id: "p2", title: "LG 32 inch TV", barcode: null, sku: "TVS-000013", ref: 100_043 })];
    expect(findProducts(list, "036000291452").exact?.id).toBe(tv);
    expect(findProducts(list, "tvs-000013").exact?.title).toBe("LG 32 inch TV");
    expect(findProducts(list, "inch").matches).toHaveLength(2);
    expect(findProducts(list, "  ").matches).toHaveLength(2);
  });

  it("reads the sales filters from the address, a day as the shop's own day", () => {
    expect(salesQuery({}).api).toBe("?limit=25&offset=0");
    expect(salesQuery({ q: "POS-0001'; drop", status: "refunded", day: "2026-11-11", page: "2" }).api).toBe(
      "?limit=25&offset=25&status=refunded&q=POS-0001drop&from=2026-11-10T23%3A00%3A00.000Z&to=2026-11-11T23%3A00%3A00.000Z",
    );
    expect(shopToday(new Date("2026-11-11T23:30:00Z"))).toBe("2026-11-12");
  });
});

describe("selling", () => {
  it("sends the sale with the basket's id as its idempotency key, so a lost reply is never a second sale", async () => {
    reply = sale();
    const result = await ringUp({ till_id: till, client_sale_id: basket, lines: [{ listing_id: tv, quantity: 2 }], payments: [{ method: "cash", amount: 53_750_000, tendered: 55_000_000, reference: "" }], expected_total: 53_750_000 });
    expect(result.ok).toBe(true);
    expect(sent[0]).toMatchObject({ method: "POST", url: "/v1/pos/owner/sales" });
    expect(sent[0]!.headers["idempotency-key"]).toBe(`sale-${basket}`);
    expect(sent[0]!.body).toEqual({ till_id: till, client_sale_id: basket, lines: [{ listing_id: tv, quantity: 2 }], payments: [{ method: "cash", amount: 53_750_000, tendered: 55_000_000 }], expected_total: 53_750_000 });
  });

  it("checks what it sends: never a basket without products, an unknown method, or another till", async () => {
    expect(await ringUp({ till_id: till, client_sale_id: basket, lines: [], payments: [], expected_total: 0 })).toMatchObject({ ok: false, param: "lines" });
    expect(await ringUp({ till_id: till, client_sale_id: basket, lines: [{ listing_id: tv, quantity: 1 }], payments: [{ method: "crypto" as never, amount: 1 }], expected_total: 1 })).toMatchObject({ ok: false, param: "payments" });
    expect(await ringUp({ till_id: "../x", client_sale_id: basket, lines: [{ listing_id: tv, quantity: 1 }], payments: [], expected_total: 1 })).toMatchObject({ ok: false, param: "till_id" });
    expect(sent).toHaveLength(0);
  });

  it("refunds with a reason, and changes stock as asked", async () => {
    reply = sale({ status: "refunded" });
    expect(await refundSale(sale().id, " ")).toMatchObject({ ok: false, param: "reason" });
    await refundSale(sale().id, "Returned unopened", false);
    expect(sent[0]).toMatchObject({ url: `/v1/pos/owner/sales/${sale().id}/refund`, body: { reason: "Returned unopened", restock: false } });
    await adjustStock(tv, "restock", 10, " Delivery ");
    expect(sent[1]).toMatchObject({ url: `/v1/pos/owner/stock/${tv}`, body: { kind: "restock", quantity: 10, note: "Delivery" } });
    expect(await adjustStock(tv, "damage", 0)).toMatchObject({ ok: false, param: "quantity" });
  });
});

describe("the screens", () => {
  it("draws the register with the shop's products, what each has free, and why one cannot sell", () => {
    const html = renderToStaticMarkup(
      <Register tillId={till} vatBps={750} currency="NGN" planName="Free" categories={[{ id: "top", name: "Electronics", count: 2, featured: true }, { id: "home", name: "Home and living", count: 1, featured: false }]} products={[product(), product({ id: "p2", title: "Old radio", available: 0, stock: 0, held: 0 }), product({ id: "p3", title: "Spare TV", blocked: "plan_limit" })]} />,
    );
    expect(html).toContain('placeholder="Scan a barcode, or type a name or SKU"');
    expect(html).toContain("Samsung 43 inch smart TV");
    expect(html).toContain("₦250,000");
    expect(html).toContain("3 free");
    expect(html).toContain("Out of stock");
    expect(html).toContain("Over Free&#x27;s limit");
    expect(html).toContain("Scan or tap products to add them.");
    expect(html).toContain("Electronics");
  });

  it("lists sales with what was taken, and opens one with its refund", async () => {
    reply = { object: "list", currency: "NGN", summary: { sales: 1, takings: 53_750_000, refunds: 1, refunded: 1_000_000 }, total: 2, has_more: false, data: [sale(), sale({ id: "r1", number: "POS-000006", status: "refunded", total: 1_000_000 })] } satisfies PosSales;
    const list = renderToStaticMarkup(await SalesPage({ searchParams: Promise.resolve({ status: "" }) }));
    expect(sent[0]!.url).toBe("/v1/pos/owner/sales?limit=25&offset=0");
    expect(list).toContain("₦537,500");
    expect(list).toContain("POS-000007");
    expect(list).toContain("Refunded");
    expect(list).toContain(`href="/app/sales/${sale().id}"`);

    reply = sale();
    const one = renderToStaticMarkup(await SalePage({ params: Promise.resolve({ id: sale().id }) }));
    expect(one).toContain("Sale POS-000007");
    expect(one).toContain("given ₦550,000, change ₦12,500");
    expect(one).toContain("VAT 7.5%");
    expect(one).toContain("Refund this sale");

    reply = sale({ status: "refunded", refunded_at: "2026-11-11T15:00:00.000Z", refund_reason: "Returned unopened", restocked: true });
    const refunded = renderToStaticMarkup(await SalePage({ params: Promise.resolve({ id: sale().id }) }));
    expect(refunded).toContain("Returned unopened");
    expect(refunded).toContain("Its items went back into stock.");
    expect(refunded).not.toContain("Refund this sale");
  });
});
