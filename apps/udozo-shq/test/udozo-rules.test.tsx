import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeApi, modalDialogs, refusal, renderSignedIn, store } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

// Loading the app's start-up module points the shared client at Udozo's API, as in the browser.
await import("@/app/api-product");
const { SetupFeeCard } = await import("@/components/setup-fee");
const { FreeDomainCard, freeDomainState } = await import("@/components/free-domain");
const { StoreLiveSwitch } = await import("@/components/store-settings");

const slow = { timeout: 5000 };
const freeBase = { object: "free_domain", allowance: 1, used: 0, available: false, covers_up_to: { amount: 0, currency: "NGN" } };
const contact = { first_name: "Ada", last_name: "Obi", email: "ada@example.com", phone: "+2348031234567", country: "NG" };

beforeAll(modalDialogs);
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("the Seller HQ setup fee", () => {
  test("due: shows the amount and pays it from the live wallet after confirming", async () => {
    let paid = false;
    const sent = fakeApi({
      "GET /v1/billing/setup-fee": () => ({ object: "setup_fee", charged: true, due: !paid, amount: 5_000_000, currency: "NGN", paid_at: paid ? "2026-10-30T10:00:00.000Z" : null }),
      "POST /v1/billing/setup-fee": () => {
        paid = true;
        return { object: "setup_fee", charged: true, due: false, amount: 5_000_000, currency: "NGN", paid_at: "2026-10-30T10:00:00.000Z" };
      },
    });
    renderSignedIn(<SetupFeeCard />);
    expect(await screen.findByText("Due", {}, slow)).toBeTruthy();
    const pay = screen.getByRole("button", { name: /^Pay / });
    expect(pay.textContent).toMatch(/50,000/);
    fireEvent.click(pay);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Pay / }));
    await waitFor(() => expect(sent.some(call => call.method === "POST" && call.path === "/v1/billing/setup-fee")).toBe(true), slow);
    expect(await screen.findByText(/Nothing more is due/, {}, slow)).toBeTruthy();
    expect(screen.getByText("Paid")).toBeTruthy();
  });

  test("paid: says when, and offers nothing to pay", async () => {
    fakeApi({ "GET /v1/billing/setup-fee": { object: "setup_fee", charged: true, due: false, amount: 5_000_000, currency: "NGN", paid_at: "2026-10-28T10:00:00.000Z" } });
    renderSignedIn(<SetupFeeCard />);
    expect(await screen.findByText(/Paid .*50,000.* on /, {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Pay / })).toBeNull();
  });

  test("the sandbox cannot pay it", async () => {
    window.localStorage.setItem("udozo-shq-mode", "test");
    fakeApi({ "GET /v1/billing/setup-fee": { object: "setup_fee", charged: true, due: true, amount: 5_000_000, currency: "NGN", paid_at: null } });
    renderSignedIn(<SetupFeeCard />);
    expect(await screen.findByText(/Switch to live to pay it/, {}, slow)).toBeTruthy();
    expect((screen.getByRole("button", { name: /^Pay / }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Premium's free domain", () => {
  test("its states, from what the API says", () => {
    expect(freeDomainState({ ...freeBase, allowance: 0 } as never)).toBe("none");
    expect(freeDomainState({ ...freeBase, used: 1 } as never)).toBe("used");
    expect(freeDomainState({ ...freeBase } as never)).toBe("unpaid");
    expect(freeDomainState({ ...freeBase, available: true, covers_up_to: { amount: 2_000_000, currency: "NGN" } } as never)).toBe("ready");
  });

  test("without Premium it points to the plans", async () => {
    fakeApi({ [`/v1/stores/${store.id}/free-domain`]: { ...freeBase, allowance: 0 } });
    renderSignedIn(<FreeDomainCard store={store.id} live contactDefaults={contact} canManage />);
    const link = await screen.findByRole("link", { name: "See Premium" }, slow);
    expect(link.getAttribute("href")).toBe(`/settings/plan?store=${store.id}`);
  });

  test("once claimed, it says so", async () => {
    fakeApi({ [`/v1/stores/${store.id}/free-domain`]: { ...freeBase, used: 1 } });
    renderSignedIn(<FreeDomainCard store={store.id} live contactDefaults={contact} canManage />);
    expect(await screen.findByText(/has had its free domain/, {}, slow)).toBeTruthy();
    expect(screen.getByText("Claimed")).toBeTruthy();
  });

  test("Premium given without a payment covers nothing", async () => {
    fakeApi({ [`/v1/stores/${store.id}/free-domain`]: freeBase });
    renderSignedIn(<FreeDomainCard store={store.id} live contactDefaults={contact} canManage />);
    expect(await screen.findByText(/has not collected a payment yet/, {}, slow)).toBeTruthy();
  });

  test("ready: search, choose, and a domain dearer than Premium covers is refused with the API's words", async () => {
    const sent = fakeApi({
      [`/v1/stores/${store.id}/free-domain`]: { ...freeBase, available: true, covers_up_to: { amount: 2_000_000, currency: "NGN" } },
      [`/v1/stores/${store.id}/domains/search`]: { object: "list", data: [{ object: "domain_offer", domain: "adaresale.com", available: true, price: { amount: 1500, currency: "USD" }, renewal_price: { amount: 1500, currency: "USD" } }] },
      [`POST /v1/stores/${store.id}/free-domain`]: refusal(409, "domain_not_covered", "adaresale.com costs ₦25,000.00, more than the ₦20,000.00 your Premium covers.", "domain"),
    });
    renderSignedIn(<FreeDomainCard store={store.id} live contactDefaults={{ ...contact, address1: "1 Marina", city: "Lagos", state: "Lagos", zip: "100001" }} canManage />);
    expect(await screen.findByText(/costing up to .*20,000/, {}, slow)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Domain name"), { target: { value: "adaresale" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose" }, slow));
    fireEvent.click(await screen.findByRole("button", { name: "Get it free" }));
    expect(await screen.findByText("Not covered by your Premium", {}, slow)).toBeTruthy();
    const claim = sent.find(call => call.method === "POST" && call.path.endsWith("/free-domain"));
    expect(claim?.body).toMatchObject({ domain: "adaresale.com", contact: { country: "NG", first_name: "Ada" } });
  });
});

describe("taking a store live", () => {
  test("before asking: no domain and the setup fee due are shown with their links", async () => {
    fakeApi({
      [`/v1/stores/${store.id}/domains`]: { object: "list", data: [], buying: { available: true, tlds: ["com"] }, max_domains: 5 },
      "/v1/billing/setup-fee": { object: "setup_fee", charged: true, due: true, amount: 5_000_000, currency: "NGN", paid_at: null },
    });
    renderSignedIn(<StoreLiveSwitch store={store as never} canManage />);
    expect(await screen.findByText("Your store needs its own domain", {}, slow)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Buy or connect a domain" }).getAttribute("href")).toBe(`/store/domains?store=${store.id}`);
    expect(await screen.findByText("Pay your Seller HQ setup fee", {}, slow)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pay the setup fee" }).getAttribute("href")).toBe("/settings/plan");
  });

  test("the API's domain_required refusal shows what to do", async () => {
    const sent = fakeApi({
      [`/v1/stores/${store.id}/domains`]: { object: "list", data: [{ object: "store_domain", id: "d1", name: "adaresale.com", status: "active" }], buying: { available: true, tlds: ["com"] }, max_domains: 5 },
      "/v1/billing/setup-fee": { object: "setup_fee", charged: false, due: false, amount: 0, currency: "NGN", paid_at: null },
      [`PATCH /v1/stores/${store.id}`]: refusal(409, "domain_required", "Connect or buy a domain for this store first: a store takes live payments only on its own domain.", "checkout_mode"),
    });
    renderSignedIn(<StoreLiveSwitch store={store as never} canManage />);
    // With an active domain and no fee, nothing is flagged before asking.
    await waitFor(() => expect(sent.some(call => call.path === "/v1/billing/setup-fee")).toBe(true), slow);
    expect(screen.queryByText("Your store needs its own domain")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Go live" }, slow));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Go live" }));
    expect(await screen.findByText("Your store needs its own domain", {}, slow)).toBeTruthy();
    expect(sent.find(call => call.method === "PATCH")?.body).toEqual({ checkout_mode: "live" });
  });

  test("the API's setup_fee_unpaid refusal shows what to do", async () => {
    fakeApi({
      [`/v1/stores/${store.id}/domains`]: { object: "list", data: [{ object: "store_domain", id: "d1", name: "adaresale.com", status: "active" }], buying: { available: true, tlds: ["com"] }, max_domains: 5 },
      "/v1/billing/setup-fee": { object: "setup_fee", charged: false, due: false, amount: 0, currency: "NGN", paid_at: null },
      [`PATCH /v1/stores/${store.id}`]: refusal(409, "setup_fee_unpaid", "Pay your Seller HQ setup fee first: Settings > Plans.", "checkout_mode"),
    });
    renderSignedIn(<StoreLiveSwitch store={store as never} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Go live" }, slow));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Go live" }));
    expect(await screen.findByText("Pay your Seller HQ setup fee", {}, slow)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Pay the setup fee" }).getAttribute("href")).toBe("/settings/plan");
  });
});
