import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({ id: "r1" }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/" }));

// Loading the app's start-up module points every request at Udozo's own API instance, as in the browser.
await import("@/app/api-product");
const { menus, sections } = await import("@/components/shell");
const { default: OverviewPage } = await import("@/app/(console)/page");
const { default: ThemePage } = await import("@/app/(console)/theme/page");
const { default: SetupFeesPage } = await import("@/app/(console)/plans/setup-fees/page");
const { default: QueuePage } = await import("@/app/(console)/classifieds/page");
const { default: PayoutsPage } = await import("@/app/(console)/money/payouts/page");

const admin = { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["operations", "finance"] };
const navy = { primary: "#070f4c", accent: "#d6136a", ink: "#0f172a", page: "#ffffff" };
const forest = { primary: "#14532d", accent: "#b45309", ink: "#111827", page: "#ffffff" };
const theme = {
  object: "theme_settings",
  draft: { preset: "forest", colors: forest },
  published: { preset: "navy_pink", colors: navy },
  version: 1,
  published_at: "2026-10-30T00:00:00.000Z",
  presets: [
    { key: "navy_pink", name: "Navy and pink", colors: navy },
    { key: "forest", name: "Forest", colors: forest },
  ],
};
const fee = { object: "setup_fee_setting", country: "NG", name: "Nigeria", currency: "NGN", enabled: true, amount: 500000, premium_month: 1000000, dearest_domain: 2500000, warnings: ["fees_below_domain_price"] };
const listing = {
  object: "classified_listing",
  id: "l1",
  ref: 1042,
  title: "iPhone 15, 128GB",
  photos: [],
  cover_url: null,
  price: { kind: "fixed", amount: 85000000, currency: "NGN" },
  category: { name: "Phones" },
  seller: { id: "c1", name: "Bola Seller", member_since: "2026-10-01T00:00:00.000Z", published_listings: 0, phone_confirmed: true },
  review_flags: ["first_listings"],
  review_reason: null,
  open_reports: [],
  submitted_at: "2026-10-30T08:00:00.000Z",
};

let sent: Array<{ method: string; path: string; body: unknown }>;
let savedFee: typeof fee;
let opened: { location: { href: string }; close: () => void } | null;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  sent = [];
  opened = null;
  savedFee = fee;
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  process.env.NEXT_PUBLIC_UDOZO_URL = "https://udozo.test";
  vi.stubGlobal("open", () => {
    opened = { location: { href: "about:blank" }, close: () => undefined };
    return opened;
  });
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: `${url.pathname}${url.search}`, body });
    const path = url.pathname;
    const ok = (value: unknown) => Response.json(value);
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/notifications") return ok({ object: "list", data: [], has_more: false });
    if (path === "/v1/admin/theme") return ok(theme);
    if (path === "/v1/admin/theme/draft") {
      const colors = (body as { colors?: { primary: string } } | null)?.colors;
      if (colors?.primary === "#ffff00")
        return Response.json({ error: { type: "invalid_request_error", code: "theme_contrast", message: "White text on buttons must be readable: 1.07 to 1, at least 4.5 to 1 needed.", param: "colors.primary" } }, { status: 400 });
      return ok({ ...theme, draft: { preset: null, colors } });
    }
    if (path === "/v1/admin/theme/preview") return ok({ object: "theme_preview", token: "tok.sig", expires_at: "2026-10-30T01:00:00.000Z" });
    if (path === "/v1/admin/theme/publish") return ok({ ...theme, published: theme.draft, version: 2 });
    if (path === "/v1/admin/setup-fees") return ok({ object: "list", data: [savedFee] });
    if (path === "/v1/admin/setup-fees/NG") {
      savedFee = { ...fee, ...(body as object), warnings: [] };
      return ok(savedFee);
    }
    if (path === "/v1/admin/classifieds/queue") return ok({ object: "list", data: [listing], stats: { waiting: 1, oldest_submitted_at: listing.submitted_at, approved_today: 4, sent_back_today: 1, removed_today: 0 } });
    if (path === "/v1/admin/customer-payouts")
      return ok({
        object: "list",
        data: [
          {
            object: "customer_payout",
            id: "p1",
            reference: "bc_cpo_1",
            mode: "live",
            status: "paid",
            amount: 2500000,
            currency: "NGN",
            customer: { id: "c1", email: "bola@example.com" },
            bank_account: { bank_name: "Example Bank", account_number_last4: "1234" },
            account_name: "Bola Seller",
            failure_reason: null,
            needs_review: false,
            provider: "flutterwave",
            created_at: "2026-10-30T00:00:00.000Z",
          },
        ],
      });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const slow = { timeout: 10000 };
const page = (element: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{element}</AdminGate>
    </AdminProviders>,
  );

/** Areas only BitoCard's instance serves: its API answers them as unknown routes on Udozo's. */
const bitocardOnly = ["/catalog", "/orders", "/storefront", "/crypto", "/settings/fees", "/resellers/connections", "/orders/vpn", "/storefront/spins", "/orders/disputes", "/reports/suppliers"];

describe("admin.udozo.com", () => {
  test("the rail and menus are Udozo's, with none of BitoCard's own areas", () => {
    const hrefs = [...sections.map(item => item.href), ...Object.values(menus).flatMap(menu => menu.items.map(item => item.href))];
    for (const href of bitocardOnly) expect(hrefs.some(item => item === href || item.startsWith(`${href}/`)), href).toBe(false);
    expect(sections.map(item => item.label)).toEqual(["Home", "Marketplace", "Shop assistants", "Resellers", "Money", "Plans & fees", "Theme", "Identity", "Support", "Reports", "Settings"]);
    expect(menus.marketplace.items.map(item => item.href)).toContain("/classifieds/resale-reports");
    expect(menus.plans.items.map(item => item.href)).toEqual(["/plans", "/plans/setup-fees"]);
    expect(JSON.stringify(menus)).not.toMatch(/BitoCard|Bitocard/);
  });

  test("the shell names Udozo, with its own mark, and calls only Udozo's API instance", async () => {
    page(<OverviewPage />);
    expect(await screen.findByRole("heading", { name: /Ada/ }, slow)).toBeTruthy();
    expect(await screen.findByText("ads waiting for review", { exact: false }, slow)).toBeTruthy();
    expect(screen.getAllByText("Udozo").length).toBeGreaterThan(0);
    expect(document.querySelector('img[src="/udozo-mark-light.png"]')).toBeTruthy();
    expect(screen.queryByText("Catalog")).toBeNull();
    expect(sent.every(call => !call.path.startsWith("/v1/afrippa/")), "never Afrippa's routes").toBe(true);
  });

  test("theme: a colour that is not readable shows the API's contrast error on its field", async () => {
    page(<ThemePage />);
    const primary = (await screen.findByLabelText("Primary", {}, slow)) as HTMLInputElement;
    expect(primary.value).toBe("#14532d");
    expect(screen.getAllByTestId("theme-swatch").length).toBe(2);
    fireEvent.change(primary, { target: { value: "#ffff00" } });
    expect(screen.getByText("Your unsaved colours.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(sent.find(call => call.path === "/v1/admin/theme/draft")?.body).toEqual({ colors: { ...forest, primary: "#ffff00" } }), slow);
    const message = await screen.findByText(/White text on buttons must be readable/, {}, slow);
    // Shown with the field it is about, which is marked invalid.
    expect(message.closest("div")?.querySelector("#theme-primary")).toBeTruthy();
    expect(primary.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled, "unsaved colours are never published").toBe(true);
  });

  test("theme: choosing a ready-made theme saves it as the draft", async () => {
    page(<ThemePage />);
    fireEvent.click(await screen.findByRole("button", { name: /Navy and pink/ }, slow));
    await waitFor(() => expect(sent.find(call => call.path === "/v1/admin/theme/draft")?.body).toEqual({ preset: "navy_pink" }), slow);
  });

  test("theme: preview opens udozo.com with the token, and publish sends the saved draft live", async () => {
    page(<ThemePage />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview on udozo.com" }, slow));
    await waitFor(() => expect(opened?.location.href).toBe("https://udozo.test/?theme_preview=tok.sig"), slow);
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(sent.some(call => call.method === "POST" && call.path === "/v1/admin/theme/publish")).toBe(true), slow);
    expect(await screen.findByText(/Published\. Every Udozo app/, {}, slow)).toBeTruthy();
  });

  test("setup fees: the warning when the fee and a Premium month are below the dearest domain, and saving a market's fee", async () => {
    page(<SetupFeesPage />);
    expect(await screen.findByText("The fees may not cover a free domain", {}, slow)).toBeTruthy();
    const market = screen.getByRole("listitem", { name: "Nigeria" });
    expect(within(market).getByText(/less than the dearest domain on offer/)).toBeTruthy();
    const amount = within(market).getByLabelText("Amount (NGN)") as HTMLInputElement;
    expect(amount.value).toBe("5000");
    fireEvent.change(amount, { target: { value: "20000" } });
    fireEvent.click(within(market).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent.find(call => call.method === "PUT")).toEqual({ method: "PUT", path: "/v1/admin/setup-fees/NG", body: { enabled: true, amount: 2000000 } }), slow);
    expect(await screen.findByText(/Saved\. New sellers in this market/, {}, slow)).toBeTruthy();
  });

  test("marketplace: the moderation queue lists ads waiting for a person", async () => {
    page(<QueuePage />);
    expect((await screen.findAllByText("iPhone 15, 128GB", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bola Seller").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Approve" }).length).toBeGreaterThan(0);
    expect(sent.some(call => call.path.startsWith("/v1/admin/classifieds/queue"))).toBe(true);
    expect(screen.queryByText(/BitoCard/)).toBeNull();
  });

  test("money: sellers' Safe pay payouts from Udozo's own list", async () => {
    page(<PayoutsPage />);
    expect((await screen.findAllByText("Safe pay payouts", {}, slow)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText("bola@example.com", {}, slow)).length).toBeGreaterThan(0);
    expect(sent.find(call => call.path.startsWith("/v1/admin/customer-payouts"))?.path).toBe("/v1/admin/customer-payouts?mode=live");
  });
});
