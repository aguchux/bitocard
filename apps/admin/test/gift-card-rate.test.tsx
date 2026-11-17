// Catalog > Products: a gift card opens the rate dialog: each supplier's rate, BitoCard's markup (the card's own, or
// the gift card markup), the rate to resellers and each value of the card, and why a supplier cannot sell here.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import type { AdminProduct } from "@bitocard/api-client/admin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/catalog" }));

const { GiftCardRateDialog } = await import("@/app/(console)/catalog/gift-card-rate");

let sent: Array<{ method: string; path: string; search: string; body: unknown }>;

const preview = (marginBps: number, level: string) => ({
  object: "admin_price_preview",
  product_id: "p1",
  country: "NG",
  currency: "NGN",
  face_value: 2500,
  face_price: 3_806_250,
  face_values: [2500, 5000],
  range: null,
  single_value: false,
  current: { kind: "markup", level: "category", rule_id: "r1", margin_bps: 1000, reseller_discount_bps: 0, fixed_price: null, fixed_currency: null },
  trial: level === "product" ? { kind: "markup", level: "product", rule_id: "trial", margin_bps: marginBps, reseller_discount_bps: 0, fixed_price: null, fixed_currency: null } : null,
  offers: [
    { offer_id: "o1", supplier_code: "reloadly", supplier_name: "Reloadly", face_value: 2500, face_price: 3_806_250, covers: true, supplier_cost_original: 2574, supplier_currency: "USD", supplier_cost: 3_918_915, supplier_discount_bps: -296, rule: {}, scheme: "markup", sellable: true, reason: null, wholesale: 4_310_807, bitocard_profit: 391_892, reseller_discount: null, chosen: true, supplier_rate: 156_756.6, bitocard_rate: 172_432.28 },
    { offer_id: "o2", supplier_code: "zendit", supplier_name: "Zendit", face_value: 2500, face_price: 3_806_250, covers: true, supplier_cost_original: 2500, supplier_currency: "USD", supplier_cost: null, supplier_discount_bps: null, rule: {}, scheme: null, sellable: false, reason: "supplier_not_in_market", wholesale: null, bitocard_profit: null, reseller_discount: null, chosen: false, supplier_rate: null, bitocard_rate: null },
  ],
  unavailable_reason: null,
  rate: {
    face_currency: "USD",
    margin_bps: marginBps,
    level,
    supplier_rate: 156_756.6,
    bitocard_rate: Math.round(156_756.6 * (10_000 + marginBps)) / 10_000,
    values: [
      { face_value: 2500, cost: 3_918_915, wholesale: Math.ceil((3_918_915 * (10_000 + marginBps)) / 10_000), bitocard_profit: Math.ceil((3_918_915 * marginBps) / 10_000) },
      { face_value: 5000, cost: 7_837_830, wholesale: Math.ceil((7_837_830 * (10_000 + marginBps)) / 10_000), bitocard_profit: Math.ceil((7_837_830 * marginBps) / 10_000) },
    ],
  },
});

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" || input.method === "DELETE" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    if (url.pathname === "/v1/admin/countries") return Response.json({ object: "list", data: [{ code: "NG", name: "Nigeria", currency: "NGN", categories: [] }] });
    if (url.pathname === "/v1/admin/pricing-rules/preview") {
      const margin = url.searchParams.get("margin_bps");
      return Response.json(margin ? preview(Number(margin), "product") : preview(1000, "category"));
    }
    if (url.pathname === "/v1/admin/pricing-rules" && input.method === "PUT") return Response.json({ object: "pricing_rule", id: "r2" });
    if (url.pathname === "/v1/admin/products/p1") return Response.json({ id: "p1", listed: true });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const product = { id: "p1", name: "Amazon US", category: "gift_cards", country: "US", face_currency: "USD", listed: false } as unknown as AdminProduct;

describe("Gift card rates in the admin app", () => {
  test("shows each supplier’s rate or why it cannot sell, and saves the card’s own markup", async () => {
    render(
      <AdminProviders>
        <GiftCardRateDialog product={product} open finance operator onClose={() => undefined} />
      </AdminProviders>,
    );
    const suppliers = await screen.findByRole("region", { name: "Supplier rates" }, { timeout: 10000 });
    expect(within(suppliers).getByText(/per \$1/)).toBeTruthy();
    expect(within(suppliers).getByText("The supplier is not switched on for gift cards in this market")).toBeTruthy();
    expect(screen.getByText("Rate to resellers")).toBeTruthy();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);

    fireEvent.change(screen.getByLabelText("BitoCard markup"), { target: { value: "own" } });
    fireEvent.change(screen.getByLabelText(/Markup on what the supplier charges/), { target: { value: "12.5" } });
    await waitFor(() => expect(sent.some(item => item.search.includes("margin_bps=1250"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Save and list" }));
    await waitFor(() => expect(sent.find(item => item.method === "PUT")?.body).toEqual({ product_id: "p1", kind: "markup", margin_bps: 1250 }));
    await waitFor(() => expect(sent.some(item => item.method === "PATCH" && item.path === "/v1/admin/products/p1")).toBe(true));
  });

  test("a markup above 200% cannot be saved", async () => {
    render(
      <AdminProviders>
        <GiftCardRateDialog product={product} open finance operator={false} onClose={() => undefined} />
      </AdminProviders>,
    );
    await screen.findByRole("region", { name: "Supplier rates" }, { timeout: 10000 });
    fireEvent.change(screen.getByLabelText("BitoCard markup"), { target: { value: "own" } });
    fireEvent.change(screen.getByLabelText(/Markup on what the supplier charges/), { target: { value: "250" } });
    expect(screen.getByText("Enter a markup from 0 to 200%.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
