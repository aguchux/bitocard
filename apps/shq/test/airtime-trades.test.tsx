// Airtime trades: unused airtime a reseller's customers sold and bought on their stores, the rates they get with the
// reseller's cut per network (their airtime markup, capped), what the reseller earned, and why it is closed when it is.
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/airtime-trades" }));
vi.mock("@/components/shq-shell", () => ({ ShqShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
const role = { value: "owner" };
vi.mock("@/components/reseller", () => ({
  useReseller: () => ({ membership: { role: role.value }, mode: "live" }),
  can: (membership: { role: string }, ...roles: string[]) => membership.role === "owner" || roles.includes(membership.role),
}));

const { default: AirtimeTradesPage } = await import("@/app/(console)/airtime-trades/page");

let answer: unknown;
const who = { id: "c1", name: "Chi Okafor", email: "chi@example.com" };
const sale = { object: "airtime_sale", id: "s1", number: "AS-000001", mode: "live", network: "mtn", amount: 100_000, currency: "NGN", rate_bps: 7760, payout: 77_600, from_phone: "+2348031230001", status: "credited", expires_at: new Date().toISOString(), sent_at: null, received_at: null, credit_at: null, credited_at: null, note: null, created_at: new Date().toISOString(), customer: who, cut_bps: 300, earned: 2_400 };
const purchase = { object: "airtime_purchase", id: "p1", number: "AP-000001", mode: "live", network: "mtn", phone: "+2348031230001", amount: 50_000, currency: "NGN", rate_bps: 9064, price: 45_320, status: "delivered", expires_at: new Date().toISOString(), delivered_at: null, refunded_at: null, note: null, created_at: new Date().toISOString(), customer: who, cut_bps: 300, earned: 1_320 };
const exchange = (over: object) => ({ object: "airtime_exchange", mode: "live", available: true, reason: null, currency: "NGN", markup_bps: 300, networks: [{ network: "mtn", name: "MTN", enabled: true, cut_bps: 300, cap_bps: 500, sell_rate_bps: 7760, buy_rate_bps: 9064 }], sales: [sale], purchases: [purchase], ...over });

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  role.value = "owner";
  globalThis.fetch = (async (input: Request) => {
    const url = new URL(input.url);
    if (url.pathname === "/v1/airtime/exchange") return Response.json(answer);
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found.", request_id: "req_1" } }, { status: 404 });
  }) as typeof fetch;
});

afterEach(cleanup);

const page = () =>
  render(
    <AdminProviders>
      <AirtimeTradesPage />
    </AdminProviders>,
  );

describe("airtime traded on a reseller's stores", () => {
  it("shows their cut, each network's rates for customers, and what they earned", async () => {
    answer = exchange({});
    page();
    expect(await screen.findByText("Your cut: 3% of BitoCard’s rates")).toBeTruthy();
    expect(screen.getAllByText("77.6%").length).toBeGreaterThan(0);
    expect(screen.getAllByText("3% (up to 5%)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₦776.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₦24.00").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Bought from you" }));
    expect(screen.getAllByText("₦453.20").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₦13.20").length).toBeGreaterThan(0);
  });

  it("says why their stores do not trade airtime yet", async () => {
    answer = exchange({ available: false, reason: "not_enabled", sales: [], purchases: [] });
    page();
    expect(await screen.findByText("BitoCard has not opened the airtime exchange for your stores yet.")).toBeTruthy();
    expect(screen.getAllByText("No airtime sold yet.").length).toBeGreaterThan(0);
  });

  it("members without access are told so", () => {
    role.value = "developer";
    page();
    expect(screen.getByText("No access")).toBeTruthy();
  });
});
