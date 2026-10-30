import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { fakeApi, modalDialogs, renderSignedIn, store } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

await import("@/app/api-product");
const { default: HomePage } = await import("@/app/(console)/page");
const { default: PlanPage } = await import("@/app/(console)/settings/plan/page");

const slow = { timeout: 5000 };
const wallet = {
  object: "wallet",
  currency: "NGN",
  available: 1_250_000,
  reserved: 0,
  earnings: { withdrawable: 400_000, on_hold: 150_000, next_release_at: null },
  wallets: [],
};
const order = {
  object: "resale_order",
  id: "o1",
  number: "RO-000012",
  mode: "live",
  store_id: store.id,
  status: "locked",
  listing: { id: "l1", ref: 1201, title: "Samsung Galaxy A15" },
  quantity: 1,
  currency: "NGN",
  price: 18_000_000,
  delivery_fee: 0,
  buyer_fee: 0,
  total: 18_000_000,
  supplier_net: 16_000_000,
  margin: 2_000_000,
  reseller_fee: null,
  earnings: null,
  refund: null,
  deal_id: null,
  fulfilment: "delivery",
  courier: null,
  tracking_number: null,
  tracking_url: null,
  delivered_at: null,
  accept_by: "2026-10-31T10:00:00.000Z",
  accepted_at: null,
  created_at: "2026-10-30T10:00:00.000Z",
  updated_at: "2026-10-30T10:00:00.000Z",
};
const plan = (code: string, name: string, amount: number) => ({
  object: "plan",
  code,
  name,
  price: { amount, currency: "USD", interval: "month" },
  features: [],
  description: null,
  feature_details: code === "premium" ? [{ code: "free_domain", name: "Free domain", description: "A free domain for the store" }] : [],
  local_price: amount ? { amount: amount * 1600, currency: "NGN", fixed: true } : null,
});

beforeAll(modalDialogs);
afterEach(cleanup);

describe("Seller HQ screens", () => {
  test("home: the checklist with Udozo's steps, the wallet, stores and the resale orders waiting", async () => {
    const sent = fakeApi({
      "/v1/account/verification": { object: "identity_verification", verified: true },
      "/v1/stores": { object: "list", data: [store] },
      "/v1/billing/setup-fee": { object: "setup_fee", charged: true, due: true, amount: 5_000_000, currency: "NGN", paid_at: null },
      "/v1/wallet": wallet,
      "/v1/resale/orders": { object: "list", data: [order, { ...order, id: "o2", status: "released", listing: { ...order.listing, title: "Done deal" } }], total: 2 },
    });
    renderSignedIn(<HomePage />);
    expect(await screen.findByText("Give your store its own domain", {}, slow)).toBeTruthy();
    expect(screen.getByText("Pay the Seller HQ setup fee")).toBeTruthy();
    expect(screen.getByText("Take your store live")).toBeTruthy();
    // Only open orders wait (the table draws rows twice: a table, and cards on phones).
    expect((await screen.findAllByText("Samsung Galaxy A15", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Done deal")).toBeNull();
    expect(screen.queryByText(/BitoCard/)).toBeNull();
    expect(sent.some(call => call.path.startsWith("/v1/orders"))).toBe(false);
  });

  test("plans: the setup fee above each store's Startup and Premium, priced in the local currency", async () => {
    fakeApi({
      "/v1/billing/setup-fee": { object: "setup_fee", charged: true, due: true, amount: 5_000_000, currency: "NGN", paid_at: null },
      "/v1/subscriptions": {
        object: "list",
        account_plan: { code: "standard", name: "Startup" },
        data: [{ object: "store_subscription", store: { id: store.id, name: store.name }, plan: plan("standard", "Startup", 0), renews_at: null, cancel_at_period_end: false, past_due_since: null, next_plan: null }],
      },
      "/v1/plans": { object: "list", data: [plan("standard", "Startup", 0), plan("premium", "Premium", 1500)] },
    });
    renderSignedIn(<PlanPage />);
    expect(await screen.findByText("Seller HQ setup fee", {}, slow)).toBeTruthy();
    expect(await screen.findByText("Plans for Ada Resale", {}, slow)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose Premium" })).toBeTruthy();
    expect(screen.getByText(/24,000/)).toBeTruthy();
    expect(screen.getByText("A free domain for the store")).toBeTruthy();
  });
});
