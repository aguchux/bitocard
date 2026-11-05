// Buy orders: Marketplace > Buy orders lists them (filters by status, Open included, and market, and by the seller a
// seller's page links with), each opening its detail with every step; a seller's page shows whether their buy orders
// are paused, with Pause (reason and days) and Unpause (reason) for operations only; and Limits and words saves the
// four buy order limits. Always on Udozo's own admin routes.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

let routeId = "bo_1";
let query = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ id: routeId }),
  useSearchParams: () => query,
  usePathname: () => "/classifieds/buy-orders",
}));

await import("@/app/api-product");
const { default: ListPage } = await import("@/app/(console)/classifieds/buy-orders/page");
const { default: DetailPage } = await import("@/app/(console)/classifieds/buy-orders/[id]/page");
const { default: SellerPage } = await import("@/app/(console)/classifieds/sellers/[id]/page");
const { default: RulesPage } = await import("@/app/(console)/classifieds/rules/page");

// jsdom has no modal dialogs: open and close them as browsers do.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

let roles: string[];
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;
let pausedUntil: string | null;
let pausedReason: string | null;
let settings: Record<string, unknown>;

const order = (overrides: Record<string, unknown> = {}) => ({
  object: "classified_admin_buy_order",
  id: "bo_1",
  number: "BO-000123",
  status: "accepted",
  country: "NG",
  currency: "NGN",
  price: 45000000,
  counter: null,
  quantity: 1,
  note: "Can we meet at Ikeja?",
  meet_note: "Ikeja City Mall, Saturday noon",
  listing: { id: "lst_1", ref: 100004, title: "iPhone 13, 128GB", path: "/ng/l/100004-iphone-13-128gb", status: "active" },
  buyer: { id: "cus_2", name: "Bola Ade", email: "bola@example.com" },
  seller: { id: "cus_1", name: "Ada Obi", email: "ada@example.com" },
  respond_by: "2026-11-03T10:00:00.000Z",
  meet_by: "2026-11-10T10:00:00.000Z",
  accepted_at: "2026-11-02T09:00:00.000Z",
  bought_at: null,
  completed_at: null,
  completed_by: null,
  voided_at: null,
  void_reason: null,
  ended_by: null,
  end_reason: null,
  created_at: "2026-11-01T10:00:00.000Z",
  updated_at: "2026-11-02T09:00:00.000Z",
  ...overrides,
});

const seller = () => ({
  object: "classified_seller",
  id: "cus_1",
  name: "Ada Obi",
  email: "ada@example.com",
  country: "NG",
  member_since: "2026-01-01T00:00:00.000Z",
  phone_confirmed: true,
  avatar_url: null,
  handle: "k3x9q2m7pa",
  username: null,
  buy_orders_paused_until: pausedUntil,
  buy_orders_paused_reason: pausedReason,
  suspended: false,
  suspended_reason: null,
  suspended_at: null,
  listings: { active: 6, pending_review: 0, sold: 1, removed: 0, total: 7 },
  open_reports: 0,
  safe_pay_sales: 0,
  safe_pay: { strikes: 0, strike_limit: 3, limited: false, cancelled_after_accepting: 0, not_handed_over: 0, disputes_lost: 0, cleared_at: null, bought: 0 },
  reports: [],
});

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  routeId = "bo_1";
  query = new URLSearchParams();
  pausedUntil = null;
  pausedReason = null;
  settings = { object: "classified_market_settings", country: "NG", listing_days: 30, monthly_listing_limit: 50, first_listings_reviewed: 3, min_photos: 1, max_photos: 10, username_min_listings: 5, buy_request_hours: 48, buy_meet_days: 7, buy_open_per_buyer: 10, buy_requests_per_day: 20 };
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }, { code: "GH", name: "Ghana" }] });
    if (url.pathname === "/v1/admin/classifieds/buy-orders") {
      const rows = [order(), order({ id: "bo_2", number: "BO-000124", status: "voided", price: 1200000, listing: { id: "lst_2", ref: 100005, title: "Office chair", path: "/ng/l/100005-office-chair", status: "active" } })];
      return ok({ object: "list", data: rows, total: rows.length });
    }
    if (url.pathname === "/v1/admin/classifieds/buy-orders/bo_1")
      return ok({
        ...order(),
        steps: [
          { by: "buyer", text: "Asked to buy it for ₦450,000.", at: "2026-11-01T10:00:00.000Z" },
          { by: "seller", text: "Accepted and is holding it.", at: "2026-11-02T09:00:00.000Z" },
          { by: "udozo", text: "Reminded both to meet.", at: "2026-11-04T09:00:00.000Z" },
        ],
      });
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1") return ok(seller());
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/buy-orders/pause" && input.method === "POST") {
      pausedUntil = "2099-12-01T00:00:00.000Z";
      pausedReason = (body as { reason: string }).reason;
      return ok({ paused_until: pausedUntil, reason: pausedReason });
    }
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/buy-orders/unpause" && input.method === "POST") {
      pausedUntil = null;
      pausedReason = null;
      return ok({ paused_until: null, reason: null });
    }
    if (url.pathname === "/v1/admin/classifieds/listings") return ok({ object: "list", data: [], has_more: false, total: 0 });
    if (url.pathname === "/v1/admin/classifieds/market-settings/NG") {
      if (input.method === "PUT") settings = { ...settings, ...(body as object) };
      return ok(settings);
    }
    if (url.pathname === "/v1/admin/classifieds/words") return ok({ object: "list", data: [] });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (page: ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{page}</AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };
const listCalls = () => sent.filter(item => item.method === "GET" && item.path === "/v1/admin/classifieds/buy-orders").map(item => new URLSearchParams(item.search));
// Only Udozo's own admin routes: never BitoCard's storefront, Afrippa's or anything outside /v1/admin.
const onlyAdminRoutes = () => expect(sent.every(item => item.path.startsWith("/v1/admin/") && !item.path.startsWith("/v1/afrippa"))).toBe(true);

describe("the buy orders list", () => {
  test("shows each order with its ad, people, price and status, and filters by status and market", long, async () => {
    show(<ListPage />);
    // The table and the phone cards each draw every row.
    expect((await screen.findAllByText("BO-000123", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("BO-000124").length).toBeGreaterThan(0);
    expect(screen.getAllByText("iPhone 13, 128GB").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bola Ade").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ada Obi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Accepted, to meet").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Buyer said they did not buy it").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/NGN\s450,000\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "BO-000123" }).every(link => link.getAttribute("href") === "/classifieds/buy-orders/bo_1")).toBe(true);
    expect(listCalls()[0].get("status")).toBeNull();

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "open" } });
    await waitFor(() => expect(listCalls().some(params => params.get("status") === "open")).toBe(true), slow);
    await screen.findByRole("option", { name: "Ghana" }, slow);
    fireEvent.change(screen.getByLabelText("Market"), { target: { value: "GH" } });
    await waitFor(() => expect(listCalls().some(params => params.get("status") === "open" && params.get("country") === "GH")).toBe(true), slow);
    onlyAdminRoutes();
  });

  test("a seller's link shows only their buy orders", slow, async () => {
    query = new URLSearchParams("seller=cus_1");
    show(<ListPage />);
    expect(await screen.findByText(/Showing only this seller/, {}, slow)).toBeTruthy();
    await waitFor(() => expect(listCalls().some(params => params.get("seller") === "cus_1")).toBe(true), slow);
  });
});

describe("a buy order", () => {
  test("shows its terms, every step with who took it, and links to the people and the ad", long, async () => {
    show(<DetailPage />);
    expect(await screen.findByRole("heading", { name: "BO-000123" }, slow)).toBeTruthy();
    expect(screen.getByText("Ikeja City Mall, Saturday noon")).toBeTruthy();
    expect(screen.getByText("Can we meet at Ikeja?")).toBeTruthy();
    expect(screen.getByText("Asked to buy it for ₦450,000.")).toBeTruthy();
    expect(screen.getByText("Accepted and is holding it.")).toBeTruthy();
    expect(screen.getByText("Reminded both to meet.")).toBeTruthy();
    const steps = screen.getByText("Reminded both to meet.").closest("ol") as HTMLElement;
    expect(within(steps).getByText("Buyer")).toBeTruthy();
    expect(within(steps).getByText("Seller")).toBeTruthy();
    expect(within(steps).getByText("Udozo")).toBeTruthy();
    const onUdozo = screen.getByRole("link", { name: "Open it on udozo.com" }) as HTMLAnchorElement;
    expect(new URL(onUdozo.href).pathname).toBe("/ng/l/100004-iphone-13-128gb");
    const people = screen.getAllByRole("link", { name: "Open their marketplace page" }).map(link => link.getAttribute("href"));
    expect(people).toEqual(["/classifieds/sellers/cus_2", "/classifieds/sellers/cus_1"]);
    onlyAdminRoutes();
  });
});

describe("a seller's buy orders", () => {
  test("operations pause them with a reason and days, then unpause them", long, async () => {
    routeId = "cus_1";
    show(<SellerPage />);
    expect(await screen.findByText("Taking buy orders", {}, slow)).toBeTruthy();
    expect((screen.getByRole("link", { name: "See their buy orders" }) as HTMLAnchorElement).getAttribute("href")).toBe("/classifieds/buy-orders?seller=cus_1");

    fireEvent.click(screen.getByRole("button", { name: "Pause buy orders" }));
    let dialog = within(await screen.findByRole("dialog", {}, slow));
    expect(dialog.getByText("Pause Ada Obi's buy orders?")).toBeTruthy();
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Three no-shows this week" } });
    fireEvent.change(dialog.getByLabelText("Days to pause"), { target: { value: "400" } });
    fireEvent.click(dialog.getByRole("button", { name: "Pause buy orders" }));
    expect(await dialog.findByText("Days to pause: a whole number from 1 to 365.", {}, slow)).toBeTruthy();
    expect(sent.some(item => item.path.endsWith("/buy-orders/pause"))).toBe(false);

    fireEvent.change(dialog.getByLabelText("Days to pause"), { target: { value: "14" } });
    fireEvent.click(dialog.getByRole("button", { name: "Pause buy orders" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path.endsWith("/buy-orders/pause"))).toBe(true), slow);
    expect(sent.find(item => item.method === "POST")).toMatchObject({ path: "/v1/admin/classifieds/sellers/cus_1/buy-orders/pause", body: { reason: "Three no-shows this week", days: 14 } });
    expect(await screen.findByText(/Paused until/, {}, slow)).toBeTruthy();
    expect(screen.getByText("Three no-shows this week")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Unpause buy orders" }));
    dialog = within(await screen.findByRole("dialog", {}, slow));
    expect(dialog.queryByLabelText("Days to pause")).toBeNull();
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Spoke to them, sorted" } });
    fireEvent.click(dialog.getByRole("button", { name: "Unpause buy orders" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path.endsWith("/buy-orders/unpause"))).toBe(true), slow);
    expect(sent.filter(item => item.method === "POST").at(-1)).toMatchObject({ path: "/v1/admin/classifieds/sellers/cus_1/buy-orders/unpause", body: { reason: "Spoke to them, sorted" } });
    expect(await screen.findByText("Taking buy orders", {}, slow)).toBeTruthy();
    onlyAdminRoutes();
  });

  test("support sees whether they are paused and cannot change it", slow, async () => {
    roles = ["support"];
    routeId = "cus_1";
    pausedUntil = "2099-12-01T00:00:00.000Z";
    pausedReason = "3 buy orders voided in 90 days";
    show(<SellerPage />);
    expect(await screen.findByText(/Paused until/, {}, slow)).toBeTruthy();
    expect(screen.getByText("3 buy orders voided in 90 days")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unpause buy orders" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause buy orders" })).toBeNull();
  });
});

describe("buy order limits on Limits and words", () => {
  test("shows the four limits and saves only what changed", long, async () => {
    show(<RulesPage />);
    const hours = (await screen.findByLabelText("Hours to answer a buy order", {}, slow)) as HTMLInputElement;
    expect(hours.value).toBe("48");
    expect((screen.getByLabelText("Days to meet once accepted") as HTMLInputElement).value).toBe("7");
    expect((screen.getByLabelText("Open buy orders per buyer") as HTMLInputElement).value).toBe("10");
    const perDay = screen.getByLabelText("Buy orders a buyer may send a day") as HTMLInputElement;
    expect(perDay.value).toBe("20");

    fireEvent.change(hours, { target: { value: "169" } });
    expect(screen.getByText("Hours to answer a buy order: a whole number from 1 to 168.")).toBeTruthy();
    fireEvent.change(hours, { target: { value: "24" } });
    fireEvent.change(perDay, { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));
    expect(await screen.findByText(/Saved\./, {}, slow)).toBeTruthy();
    expect(sent.filter(item => item.method === "PUT")).toEqual([{ method: "PUT", path: "/v1/admin/classifieds/market-settings/NG", search: "", body: { buy_request_hours: 24, buy_requests_per_day: 5 } }]);
    onlyAdminRoutes();
  });

  test("a market the API sends without them reads as the defaults", slow, async () => {
    for (const key of ["buy_request_hours", "buy_meet_days", "buy_open_per_buyer", "buy_requests_per_day"]) delete settings[key];
    show(<RulesPage />);
    expect(((await screen.findByLabelText("Hours to answer a buy order", {}, slow)) as HTMLInputElement).value).toBe("48");
    expect((screen.getByLabelText("Days to meet once accepted") as HTMLInputElement).value).toBe("7");
    expect((screen.getByRole("button", { name: "Save limits" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
