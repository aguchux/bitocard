// Gift cards in SHQ are priced by rate: BitoCard's rate to the reseller, their markup on it, their rate to customers
// and each value of the card; never a fixed price.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import type { Product } from "@bitocard/api-client/reseller";
import { ProductPricingDialog } from "@/components/product-pricing";

type Sent = { method: string; path: string; search: string; body: unknown };
let sent: Sent[];

const preview = (markupBps: number, from: "product" | "category") => {
  const at = (bitocard: number) => Math.ceil((bitocard * (10_000 + markupBps)) / 10_000);
  return {
    object: "price_preview",
    product_id: "p1",
    mode: "live",
    currency: "NGN",
    face_value: 2500,
    scheme: "markup",
    face_price: null,
    bitocard_price: 4_310_807,
    your_discount: null,
    customer_discount: null,
    customer_price: at(4_310_807),
    your_profit: at(4_310_807) - 4_310_807,
    markup_cap_bps: 10_000,
    fixed_below_cost: false,
    rate: {
      face_currency: "USD",
      bitocard_rate: 172_432.28,
      customer_rate: Math.round(172_432.28 * (10_000 + markupBps)) / 10_000,
      markup_bps: markupBps,
      values: [2500, 5000].map(face => {
        const bitocard = face === 2500 ? 4_310_807 : 8_621_614;
        return { face_value: face, bitocard_price: bitocard, customer_price: at(bitocard), your_profit: at(bitocard) - bitocard };
      }),
    },
    settings: { customer_discount_bps: 0, markup_bps: markupBps, fixed_price: null, from: { customer_discount: "none", markup: from, fixed: "none" } },
  };
};

beforeEach(() => {
  // jsdom has no modal dialogs: open them as the browser would.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" || input.method === "DELETE" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    if (url.pathname === "/v1/catalogue/products/p1/price-preview") {
      const trial = url.searchParams.get("markup_bps");
      return Response.json(trial ? preview(Number(trial), "product") : preview(500, "category"));
    }
    if (url.pathname === "/v1/pricing/markups") return Response.json({ object: "pricing", currency: "NGN", markup_cap_percent: 100, markups: [] });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found.", request_id: "req_1" } }, { status: 404 });
  }) as typeof fetch;
});

afterEach(cleanup);

const card = {
  id: "p1",
  name: "Amazon US",
  category: "gift_cards",
  face_currency: "USD",
  listed: false,
  pricing: { currency: "NGN", denominations: [{ face_value: 2500, wholesale: 4_310_807, price: 4_526_348 }] },
} as unknown as Product;

describe("gift card rates in SHQ", () => {
  it("shows BitoCard’s rate, the reseller’s and each value of the card, and saves a markup for this card", async () => {
    render(
      <AdminProviders>
        <ProductPricingDialog product={card} open manage onClose={() => undefined} />
      </AdminProviders>,
    );
    expect(await screen.findByText(/BitoCard’s rate to you/)).toBeTruthy();
    expect(screen.getAllByText(/per \$1/, { selector: "p.text-xl" })).toHaveLength(2);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByLabelText(/Your customer pays/)).toBeNull();

    fireEvent.change(screen.getByLabelText("Your markup"), { target: { value: "own" } });
    fireEvent.change(screen.getByLabelText(/Your markup on BitoCard’s rate/), { target: { value: "8" } });
    await waitFor(() => expect(sent.some(item => item.search.includes("markup_bps=800"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Save and list on my store" }));
    await waitFor(() => expect(sent.find(item => item.method === "PUT" && item.path === "/v1/pricing/markups")?.body).toEqual({ product_id: "p1", markup_bps: 800 }));
  });

  it("refuses a markup above the Markup Protection Scheme", async () => {
    render(
      <AdminProviders>
        <ProductPricingDialog product={card} open manage onClose={() => undefined} />
      </AdminProviders>,
    );
    await screen.findByText(/BitoCard’s rate to you/);
    fireEvent.change(screen.getByLabelText("Your markup"), { target: { value: "own" } });
    fireEvent.change(screen.getByLabelText(/Your markup on BitoCard’s rate/), { target: { value: "150" } });
    expect(screen.getByText("Enter a markup from 0 to 100%.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save rate" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
