// An owner or admin can make an assisted sale in SHQ from any available product, pay from the reseller wallet,
// see it in the shared order list, and open its delivered secrets and redemption links.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

const pushed = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushed, replace: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ id: "o1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/orders",
}));
vi.mock("@/components/shq-shell", () => ({ ShqShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/reseller", () => ({
  useReseller: () => ({ membership: { role: "admin" }, mode: "live" }),
  can: (membership: { role: string }, ...roles: string[]) => membership.role === "owner" || roles.includes(membership.role),
}));
vi.mock("@/components/vpn", () => ({ VpnCard: () => null }));

const { default: NewOrderPage } = await import("@/app/(console)/orders/new/page");
const { default: OrdersPage } = await import("@/app/(console)/orders/page");
const { default: OrderPage } = await import("@/app/(console)/orders/[id]/page");

type Sent = { method: string; path: string; body: unknown };
let sent: Sent[];

const product = {
  object: "product",
  id: "p1",
  key: "gift_cards:US:amazon:usd",
  category: "gift_cards",
  country: "US",
  brand: "amazon",
  name: "Amazon US",
  face_currency: "USD",
  denomination: { type: "fixed", values: [2500] },
  recipient_type: "none",
  description: "Amazon gift card",
  redeem_instructions: "Redeem in your Amazon account.",
  gift_card_primary_category: "online_marketplaces",
  gift_card_categories: ["online_marketplaces"],
  gift_card_redemption_channels: ["online"],
  gift_card_countries: ["US"],
  gift_card_redemption_scope: "single_country",
  rating: { average: 4.8, count: 100 },
  logo_url: null,
  image_url: null,
  listed: false,
  pricing: { currency: "NGN", denominations: [{ face_value: 2500, wholesale: 4_000_000, price: 4_300_000 }] },
};

const quote = {
  object: "quote",
  id: "q1",
  mode: "live",
  status: "open",
  product: { id: "p1", name: "Amazon US", category: "gift_cards" },
  face_value: 2500,
  face_currency: "USD",
  quantity: 1,
  currency: "NGN",
  wholesale: 4_000_000,
  unit_wholesale: 4_000_000,
  price: 4_300_000,
  tax: null,
  reseller_profit: 300_000,
  source: "bitocard",
  integration: null,
  bitocard_fee: null,
  recipient: null,
  customer_reference: null,
  expires_at: "2099-01-01T00:00:00.000Z",
  created_at: "2026-11-27T04:00:00.000Z",
};

const order = {
  object: "order",
  id: "o1",
  mode: "live",
  status: "completed",
  quote_id: "q1",
  product: { id: "p1", name: "Amazon US", category: "gift_cards" },
  face_value: 2500,
  face_currency: "USD",
  quantity: 1,
  currency: "NGN",
  wholesale: 4_000_000,
  tax: 0,
  charged: 4_000_000,
  price: 4_300_000,
  reseller_profit: 300_000,
  source: "bitocard",
  integration: null,
  recipient: null,
  customer_reference: null,
  failure_reason: null,
  receipt_number: "BC-000001",
  created_at: "2026-11-27T04:00:00.000Z",
  updated_at: "2026-11-27T04:01:00.000Z",
  completed_at: "2026-11-27T04:01:00.000Z",
  deliveries: [{ kind: "gift_card", code: "AMAZON-CODE-1234", pin: "7788", serial: "SERIAL-1", details: { claim_url: "https://amazon.example/redeem/1", expires_at: "2027-11-27" } }],
  access: { object: "order_access_link", url: "https://shop.example/a/access-1", revealed_at: null, replaced_at: null },
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  pushed.mockReset();
  sent = [];
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    if (input.method === "GET" && url.pathname === "/v1/catalogue/products") return Response.json({ object: "list", data: [product], has_more: false, next_cursor: null });
    if (input.method === "POST" && url.pathname === "/v1/quotes") return Response.json(quote, { status: 201 });
    if (input.method === "POST" && url.pathname === "/v1/orders") return Response.json(order, { status: 201 });
    if (input.method === "GET" && url.pathname === "/v1/orders") return Response.json({ object: "list", data: [order], has_more: false, next_cursor: null });
    if (input.method === "GET" && url.pathname === "/v1/orders/o1") return Response.json(order);
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found.", request_id: "req_1" } }, { status: 404 });
  }) as typeof fetch;
});

afterEach(cleanup);

const page = (children: ReactNode) => render(<AdminProviders>{children}</AdminProviders>);

describe("assisted orders in SHQ", () => {
  it("orders an unlisted product and pays its wholesale cost from the reseller wallet", async () => {
    page(<NewOrderPage />);
    expect(await screen.findByText(/whether it is listed on your store or not/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Amazon US/i }));
    fireEvent.click(screen.getByRole("button", { name: "Get quote" }));

    expect(await screen.findByText("Pay from your wallet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₦40,000.00 from wallet" }));

    await waitFor(() => expect(pushed).toHaveBeenCalledWith("/orders/o1"));
    expect(sent.find(item => item.path === "/v1/quotes")?.body).toEqual({ product_id: "p1", face_value: 2500 });
    expect(sent.find(item => item.method === "POST" && item.path === "/v1/orders")?.body).toEqual({ quote_id: "q1" });
  });

  it("lists assisted orders with store and API orders and opens their details", async () => {
    page(<OrdersPage />);
    expect((await screen.findAllByText("Amazon US")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Every order placed in SHQ/)).toBeTruthy();
    fireEvent.click(screen.getAllByText("Amazon US")[0]!);
    expect(pushed).toHaveBeenCalledWith("/orders/o1");
  });

  it("masks delivered card details until reveal and opens redemption links", async () => {
    page(<OrderPage />);
    expect(await screen.findByText("Delivered")).toBeTruthy();
    expect(screen.queryByText("AMAZON-CODE-1234")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show code" }));
    expect(screen.getByText("AMAZON-CODE-1234")).toBeTruthy();
    const claim = screen.getByRole("link", { name: /Open claim url/i });
    expect(claim.getAttribute("href")).toBe("https://amazon.example/redeem/1");
    expect(claim.getAttribute("target")).toBe("_blank");
  });
});
