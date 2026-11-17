// Cards sold to you: the gift cards a reseller's customers sold on their stores, what each customer got and what the
// reseller earned, their cut (from their gift card markup, capped) and why buy back is closed when it is.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/gift-card-sales" }));
vi.mock("@/components/shq-shell", () => ({ ShqShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const role = { value: "owner" };
vi.mock("@/components/reseller", () => ({
  useReseller: () => ({ membership: { role: role.value }, mode: "live" }),
  can: (membership: { role: string }, ...roles: string[]) => membership.role === "owner" || roles.includes(membership.role),
}));

const { default: GiftCardSalesPage } = await import("@/app/(console)/gift-card-sales/page");

let answer: unknown;
const sale = {
  object: "gift_card_sale",
  id: "s1",
  number: "GS-000003",
  mode: "live",
  status: "completed",
  card: { name: "Amazon (USA) E-code", brand: "Amazon", brand_slug: "amazon", country: "US" },
  form: "ecode",
  amount: 100,
  currency: "NGN",
  quoted: 10_488_000,
  paid: 10_488_000,
  reason: null,
  customer: { id: "c1", name: "Chi Okafor", email: "chi@example.com" },
  spread_bps: 800,
  earned: 912_000,
  created_at: new Date().toISOString(),
  decided_at: new Date().toISOString(),
};

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  role.value = "owner";
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    if (url.pathname === "/v1/gift-card-sales/buy-back") return Response.json(answer);
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found.", request_id: "req_1" } }, { status: 404 });
  }) as typeof fetch;
});

afterEach(cleanup);

const page = () =>
  render(
    <AdminProviders>
      <GiftCardSalesPage />
    </AdminProviders>,
  );

describe("cards sold to a reseller's stores", () => {
  it("shows their cut and each sale with what the customer got and what they earned", async () => {
    answer = { object: "gift_card_buy_back", mode: "live", available: true, reason: null, currency: "NGN", spread_bps: 800, cap_bps: 1000, data: [sale] };
    page();
    expect(await screen.findByText("Your cut: 8% of BitoCard’s rate")).toBeTruthy();
    expect(screen.getByText(/up to 10%/)).toBeTruthy();
    expect(screen.getAllByText("Amazon (USA) E-code").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₦104,880.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₦9,120.00").length).toBeGreaterThan(0);
  });

  it("says why their stores do not buy cards yet", async () => {
    answer = { object: "gift_card_buy_back", mode: "live", available: false, reason: "not_enabled", currency: "NGN", spread_bps: 800, cap_bps: 1000, data: [] };
    page();
    expect(await screen.findByText("BitoCard has not opened buy back for your stores yet.")).toBeTruthy();
    expect(screen.getAllByText("No cards sold yet.").length).toBeGreaterThan(0);
  });

  it("members without access are told so and nothing is asked", async () => {
    role.value = "developer";
    page();
    expect(screen.getByText("No access")).toBeTruthy();
  });
});
