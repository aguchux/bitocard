// Marketplace › Resale settings says why sellers cannot yet let resellers sell their listings: the market's switch off,
// or the switch on with Udozo's reseller fee not set (0% being allowed).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/resale" }));

await import("@/app/api-product");
const { default: ResalePage } = await import("@/app/(console)/classifieds/resale/page");

let settings: Record<string, unknown>;
const closed = { object: "classified_resale_settings", country: "NG", discount_min_bps: 500, discount_max_bps: 5000, markup_max_bps: 3000, markup_cap_bps: 10000, reseller_fee_bps: null, reseller_fee_cap: null, accept_hours: 24, reseller_strike_limit: 3, updated_at: null, open: false };

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const path = new URL(input.url).pathname;
    const ok = (value: unknown) => Response.json(value);
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles: ["finance"] }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/countries") return ok({ object: "list", data: [{ object: "country", code: "NG", name: "Nigeria", currency: "NGN" }] });
    if (path === "/v1/admin/classifieds/resale-settings/NG") return ok(settings);
    if (path === "/v1/admin/classifieds/resale-claim-phrases") return ok({ object: "list", data: [] });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () =>
  render(
    <AdminProviders>
      <AdminGate>
        <ResalePage />
      </AdminGate>
    </AdminProviders>,
  );

describe("Resale settings", () => {
  test("the switch on but no reseller fee: says to set it (0% allowed)", { timeout: 15000 }, async () => {
    settings = { ...closed, reason: "not_set_up" };
    show();
    expect(await screen.findByText(/set Udozo's reseller fee and its cap below \(0% is allowed\)/)).toBeTruthy();
  });

  test("the switch off: says where to turn it on", { timeout: 15000 }, async () => {
    settings = { ...closed, reason: "switch_off" };
    show();
    expect(await screen.findByText(/until the Marketplace resale switch is on for this market/)).toBeTruthy();
  });

  test("open: no notice", { timeout: 15000 }, async () => {
    settings = { ...closed, reseller_fee_bps: 0, reseller_fee_cap: 0, open: true, reason: null };
    show();
    expect(await screen.findByText("Resale is open here")).toBeTruthy();
    expect(screen.queryByText(/sellers still cannot|until the Marketplace resale switch/)).toBeNull();
  });
});
