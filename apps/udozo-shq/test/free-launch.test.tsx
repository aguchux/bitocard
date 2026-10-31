import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { fakeApi, modalDialogs, renderSignedIn, store, withoutPaidPlans } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/plan",
}));

await import("@/app/api-product");
const { menusFor } = await import("@/components/nav");
const { walletPaysFor } = await import("@/components/paid-plans");
const { FreeDomainCard } = await import("@/components/free-domain");
const { StoreLiveSwitch } = await import("@/components/store-settings");
const { default: PlanPage } = await import("@/app/(console)/settings/plan/page");

const slow = { timeout: 5000 };
const contact = { first_name: "Ada", last_name: "Obi", email: "ada@example.com", phone: "+2348031234567", country: "NG" };

beforeAll(modalDialogs);
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// Udozo launches free: until an admin switches paid plans on, sellers never see plans, Premium or the setup fee.
describe("Seller HQ without paid plans", () => {
  test("Settings lists no Plans, and the wallet pays only for domains", () => {
    expect(menusFor(false).settings.items.map(item => item.label)).not.toContain("Plans");
    expect(menusFor(true).settings.items.map(item => item.label)).toContain("Plans");
    expect(walletPaysFor(false)).toBe("domains");
  });

  test("the Plans page says every store has every feature, and asks for no plans", async () => {
    const sent = fakeApi(withoutPaidPlans);
    renderSignedIn(<PlanPage />);
    expect(await screen.findByText("Nothing to choose", {}, slow)).toBeTruthy();
    expect(screen.queryByText(/Premium/)).toBeNull();
    expect(sent.some(call => call.path.startsWith("/v1/plans") || call.path.startsWith("/v1/subscriptions") || call.path.startsWith("/v1/billing/setup-fee"))).toBe(false);
  });

  test("no free domain with Premium, and a store needing a domain is not sent to the plans", async () => {
    const sent = fakeApi({
      ...withoutPaidPlans,
      [`/v1/stores/${store.id}/domains`]: { object: "list", data: [], buying: { available: true, tlds: ["com"] }, max_domains: 5 },
      "/v1/billing/setup-fee": { object: "setup_fee", charged: false, due: false, amount: 0, currency: "NGN", paid_at: null },
      "/v1/account/verification": { object: "account_verification", status: "approved" },
    });
    renderSignedIn(
      <>
        <FreeDomainCard store={store.id} live contactDefaults={contact} canManage />
        <StoreLiveSwitch store={store as never} canManage />
      </>,
    );
    expect(await screen.findByText("Your store needs its own domain", {}, slow)).toBeTruthy();
    await waitFor(() => expect(sent.some(call => call.path === "/v1/settings")).toBe(true), slow);
    expect(screen.queryByText(/Premium/)).toBeNull();
    expect(screen.queryByText(/setup fee/i)).toBeNull();
    expect(sent.some(call => call.path.endsWith("/free-domain"))).toBe(false);
  });
});
