// Usernames: each market's "Ads before choosing a username" (0 to 100) on Limits and words, saved with the other
// posting limits; and a seller's page showing their username, linking their page by it, with Remove username for
// operations only (a reason asked), always on Udozo's own admin routes.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => ({ id: "cus_1" }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/classifieds",
}));

await import("@/app/api-product");
const { default: RulesPage } = await import("@/app/(console)/classifieds/rules/page");
const { default: SellerPage } = await import("@/app/(console)/classifieds/sellers/[id]/page");

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
let sent: Array<{ method: string; path: string; body: unknown }>;
let username: string | null;
let settings: Record<string, unknown>;

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
  username,
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
  username = "adas-gadgets";
  settings = { object: "classified_market_settings", country: "NG", listing_days: 30, monthly_listing_limit: 50, first_listings_reviewed: 3, min_photos: 1, max_photos: 10, username_min_listings: 5 };
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/classifieds/market-settings/NG") {
      if (input.method === "PUT") settings = { ...settings, ...(body as object) };
      return ok(settings);
    }
    if (url.pathname === "/v1/admin/classifieds/words") return ok({ object: "list", data: [] });
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1") return ok(seller());
    if (url.pathname === "/v1/admin/classifieds/sellers/cus_1/username/remove" && input.method === "POST") {
      username = null;
      return ok({ object: "classified_seller", id: "cus_1", username: null });
    }
    if (url.pathname === "/v1/admin/classifieds/listings") return ok({ object: "list", data: [], has_more: false, total: 0 });
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
// Only Udozo's own admin routes: never BitoCard's storefront, Afrippa's or anything outside /v1/admin.
const onlyAdminRoutes = () => expect(sent.every(item => item.path.startsWith("/v1/admin/") && !item.path.startsWith("/v1/afrippa"))).toBe(true);

describe("ads before choosing a username", () => {
  test("shows the market's number, refuses outside 0 to 100, and saves only what changed", slow, async () => {
    show(<RulesPage />);
    const box = (await screen.findByLabelText("Ads before choosing a username", {}, slow)) as HTMLInputElement;
    expect(box.value).toBe("5");
    expect(screen.getByText(/once they have posted this many ads/)).toBeTruthy();
    const save = () => screen.getByRole("button", { name: "Save limits" }) as HTMLButtonElement;

    fireEvent.change(box, { target: { value: "101" } });
    expect(screen.getByText("Ads before choosing a username: a whole number from 0 to 100.")).toBeTruthy();
    expect(save().disabled).toBe(true);
    fireEvent.change(box, { target: { value: "-1" } });
    expect(save().disabled).toBe(true);

    fireEvent.change(box, { target: { value: "0" } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    expect(await screen.findByText(/Saved\./, {}, slow)).toBeTruthy();
    expect(sent.filter(item => item.method === "PUT")).toEqual([{ method: "PUT", path: "/v1/admin/classifieds/market-settings/NG", body: { username_min_listings: 0 } }]);
    onlyAdminRoutes();
  });

  test("a market the API sends without it reads as 5", slow, async () => {
    delete settings.username_min_listings;
    show(<RulesPage />);
    const box = (await screen.findByLabelText("Ads before choosing a username", {}, slow)) as HTMLInputElement;
    expect(box.value).toBe("5");
    expect((screen.getByRole("button", { name: "Save limits" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("support sees it and cannot change it", slow, async () => {
    roles = ["support"];
    show(<RulesPage />);
    const box = (await screen.findByLabelText("Ads before choosing a username", {}, slow)) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save limits" })).toBeNull();
  });
});

describe("a seller's username", () => {
  test("shows the username, links their page by it, and operations remove it with a reason", long, async () => {
    show(<SellerPage />);
    expect(await screen.findByText("adas-gadgets", {}, slow)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open their seller page" }) as HTMLAnchorElement;
    expect(new URL(link.href).pathname).toBe("/ng/seller/adas-gadgets");

    fireEvent.click(screen.getByRole("button", { name: "Remove username" }));
    const dialog = within(await screen.findByRole("dialog", {}, slow));
    expect(dialog.getByText("Remove Ada Obi's username?")).toBeTruthy();
    const dialogConfirm = () => dialog.getByRole("button", { name: "Remove username" }) as HTMLButtonElement;
    // A reason is required.
    expect(dialogConfirm().disabled).toBe(true);
    fireEvent.change(dialog.getByLabelText("Reason"), { target: { value: "Pretends to be a brand" } });
    fireEvent.click(dialogConfirm());

    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path.endsWith("/username/remove"))).toBe(true), slow);
    expect(sent.find(item => item.method === "POST")).toEqual({ method: "POST", path: "/v1/admin/classifieds/sellers/cus_1/username/remove", body: { reason: "Pretends to be a brand" } });
    expect(await screen.findByText(/No username: their seller page uses its handle/, {}, slow)).toBeTruthy();
    expect(new URL((screen.getByRole("link", { name: "Open their seller page" }) as HTMLAnchorElement).href).pathname).toBe("/ng/seller/k3x9q2m7pa");
    expect(screen.queryByRole("button", { name: "Remove username" })).toBeNull();
    onlyAdminRoutes();
  });

  test("support sees the username and cannot remove it", slow, async () => {
    roles = ["support"];
    show(<SellerPage />);
    expect(await screen.findByText("adas-gadgets", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Remove username" })).toBeNull();
  });
});
