import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

// admin.udozo.com > POS: owners' accounts with their plan, shops, tills and charges; the plans priced per market
// currency by finance only; and the app links operations set, each refused or cleared in words.
const params = { id: "acc1" };
const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href), replace: () => undefined, prefetch: () => undefined }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/pos/accounts",
}));

await import("@/app/api-product");
const { default: AccountsPage } = await import("@/app/(console)/pos/accounts/page");
const { default: AccountPage } = await import("@/app/(console)/pos/accounts/[id]/page");
const { default: PlansPage } = await import("@/app/(console)/pos/plans/page");
const { default: AppsPage } = await import("@/app/(console)/pos/apps/page");
const { menus, sections } = await import("@/components/shell");
const { accountState, draftOf, planChange } = await import("@/components/pos");

const slow = { timeout: 10000 };
const limits = { products: 50, shops: 1, tills: 1, staff: 2 };
const plan = (code: "free" | "premium" | "multi_shop", over: Record<string, unknown> = {}) => ({
  object: "pos_plan",
  code,
  name: { free: "Free", premium: "Premium", multi_shop: "Multi-shop" }[code],
  description: null,
  price: null,
  available: true,
  paid: code !== "free",
  limits: code === "free" ? limits : { products: null, shops: code === "premium" ? 1 : 5, tills: code === "premium" ? 3 : null, staff: null },
  trial_days: code === "free" ? 0 : 14,
  shown: true,
  prices: code === "premium" ? { NGN: 1_500_000 } : {},
  accounts: code === "free" ? 3 : 1,
  ...over,
});
const account = (over: Record<string, unknown> = {}) => ({
  object: "pos_account",
  id: "acc1",
  country: "NG",
  currency: "NGN",
  mode: "live",
  status: "active",
  plan: plan("premium"),
  next_plan: null,
  trial_ends_at: null,
  period_start: "2026-11-01T00:00:00.000Z",
  period_end: "2026-12-01T00:00:00.000Z",
  past_due_since: null,
  drops_to_free_at: null,
  lapsed_plan: null,
  limits: plan("premium").limits,
  shops: [{ object: "pos_shop", id: "s1", name: "Ada's Gadget Hub", address: "3 Allen Avenue", phone: null, tin: null, shop_code: "AGH-4821", vat_bps: 750, receipt_footer: null, tills: [{ object: "pos_till", id: "t1", name: "Counter 1", printer_width: 80, auto_print: true }] }],
  created_at: "2026-11-01T00:00:00.000Z",
  owner: { id: "c1", name: "Ada Okafor", email: "ada@example.com" },
  ...over,
});

let roles: string[];
let apps: Record<string, string | null>;
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;

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
  pushed.length = 0;
  roles = ["finance"];
  apps = { android: null, ios: null, windows: null };
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const path = url.pathname;
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    const refuse = (message: string, param: string) => Response.json({ error: { type: "invalid_request_error", code: "parameter_invalid", message, param } }, { status: 400 });
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ade Bello", email: "ade@udozo.com", roles }, step_up_until: null });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria", currency: "NGN" }] });
    if (path === "/v1/admin/pos/accounts") return ok({ object: "list", total: 1, data: [account()] });
    if (path === "/v1/admin/pos/accounts/acc1")
      return ok({ ...account(), charges: [{ object: "pos_charge", id: "ch1", number: "PI-000001", plan: { code: "premium", name: "Premium" }, kind: "signup", period_start: "2026-11-01T00:00:00.000Z", period_end: "2026-12-01T00:00:00.000Z", price: 1_500_000, credit: 0, amount: 1_500_000, currency: "NGN", created_at: "2026-11-01T00:00:00.000Z" }] });
    if (path === "/v1/admin/pos/plans") return ok({ object: "list", currencies: ["NGN", "GHS"], data: [plan("free"), plan("premium"), plan("multi_shop")] });
    if (path === "/v1/admin/pos/plans/premium") return ok(plan("premium"));
    if (path === "/v1/admin/pos/apps") return ok({ object: "pos_apps", ...apps });
    const app = /^\/v1\/admin\/pos\/apps\/(android|ios|windows)$/.exec(path);
    if (app) {
      const next = (body as { url: string | null }).url;
      if (next && !next.startsWith("https://play.google.com/")) return refuse("That is not the app's address on Google Play.", "url");
      apps[app[1]!] = next;
      return ok({ object: "pos_apps", ...apps });
    }
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = (children: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{children}</AdminGate>
    </AdminProviders>,
  );
const openDialog = () => within(document.querySelector<HTMLElement>("dialog[open]")!);
const lastSent = (suffix: string) => sent.filter(item => item.method !== "GET" && item.path.endsWith(suffix)).at(-1);

describe("Udozo POS", () => {
  test("has its own section with accounts, plans and prices, and app links", () => {
    expect(sections.some(item => item.key === "pos" && item.href === "/pos/accounts")).toBe(true);
    expect(menus.pos.items.map(item => item.href)).toEqual(["/pos/accounts", "/pos/plans", "/pos/apps"]);
  });

  test("lists accounts with where the plan stands, and opens one", async () => {
    shown(<AccountsPage />);
    const row = (await screen.findAllByText("Ada's Gadget Hub", {}, slow))[0]!.closest("tr")!;
    expect(row.textContent).toContain("AGH-4821");
    expect(row.textContent).toContain("ada@example.com");
    expect(row.textContent).toContain("Premium · Paid");
    fireEvent.click(row);
    expect(pushed).toEqual(["/pos/accounts/acc1"]);
  });

  test("an account shows its shop, tills and charges, linking the owner", async () => {
    shown(<AccountPage />);
    expect(await screen.findByText("Counter 1", {}, slow)).toBeTruthy();
    expect(screen.getByText("Shop code AGH-4821")).toBeTruthy();
    expect(screen.getByText("7.5%")).toBeTruthy();
    expect(screen.getByText(/PI-000001 · Premium · First month/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Ada Okafor" }).getAttribute("href")).toBe("/customers/c1");
  });

  test("words every state of a plan", () => {
    expect(accountState(account({ status: "free", plan: plan("free"), lapsed_plan: "multi_shop" }) as never)).toBe("On Free since a paid plan lapsed (multi-shop).");
    expect(accountState(account({ status: "trial", trial_ends_at: "2026-11-15T00:00:00.000Z" }) as never)).toMatch(/^Trial of Premium until /);
    expect(accountState(account({ status: "past_due", drops_to_free_at: "2026-11-08T00:00:00.000Z" }) as never)).toMatch(/^Renewal of Premium failed; drops to Free on /);
    expect(accountState(account({ next_plan: "free" }) as never)).toMatch(/, then free\.$/);
  });

  test("finance prices a plan per currency, clearing one and keeping limits unlimited where empty", async () => {
    shown(<PlansPage />);
    await screen.findByText("Multi-shop", {}, slow);
    expect(screen.getByText("Always offered")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Change" })[1]!);
    const dialog = openDialog();
    fireEvent.change(dialog.getByLabelText("NGN"), { target: { value: "" } });
    fireEvent.change(dialog.getByLabelText("GHS"), { target: { value: "150.50" } });
    fireEvent.change(dialog.getByLabelText("Tills"), { target: { value: "4" } });
    fireEvent.click(dialog.getByRole("button", { name: "Save plan" }));
    await waitFor(() => expect(lastSent("/pos/plans/premium")).toBeTruthy());
    expect(lastSent("/pos/plans/premium")!.method).toBe("PATCH");
    expect(lastSent("/pos/plans/premium")!.body).toEqual({ name: "Premium", description: "", prices: { NGN: null, GHS: 15_050 }, limits: { products: null, shops: 1, tills: 4, staff: null }, trial_days: 14, shown: true });
  });

  test("refuses what the API would, before asking it", () => {
    const free = plan("free") as never;
    const draft = draftOf(free, ["NGN"]);
    expect(planChange(free, ["NGN"], { ...draft, limits: { ...draft.limits, tills: "" } })).toEqual({ error: "Free always has a limit: give tills." });
    expect(planChange(free, ["NGN"], draft)).toEqual({ change: { name: "Free", description: "", limits } });
    const premium = plan("premium") as never;
    expect(planChange(premium, ["NGN"], { ...draftOf(premium, ["NGN"]), trial_days: "91" })).toEqual({ error: "The trial is from 0 to 90 days." });
    expect(planChange(premium, ["NGN"], { ...draftOf(premium, ["NGN"]), prices: { NGN: "0" } })).toEqual({ error: "The NGN price is not an amount above zero." });
  });

  test("only finance can change plans", async () => {
    roles = ["support"];
    shown(<PlansPage />);
    await screen.findByText("Multi-shop", {}, slow);
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  test("operations set an app's store link, see a refusal in words, and clear it", async () => {
    roles = ["operations"];
    shown(<AppsPage />);
    const field = await screen.findByLabelText("Store address", { selector: "#pos-app-android" }, slow);
    fireEvent.change(field, { target: { value: "https://example.com/app" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save link" })[0]!);
    expect(await screen.findByText("That is not the app's address on Google Play.")).toBeTruthy();
    fireEvent.change(field, { target: { value: "https://play.google.com/store/apps/details?id=com.udozo.pos" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save link" })[0]!);
    await waitFor(() => expect(apps.android).toBe("https://play.google.com/store/apps/details?id=com.udozo.pos"));
    expect(lastSent("/pos/apps/android")!.method).toBe("PUT");
    fireEvent.click(await screen.findByRole("button", { name: "Clear link" }));
    await waitFor(() => expect(apps.android).toBeNull());
    expect(lastSent("/pos/apps/android")!.body).toEqual({ url: null });
  });

  test("other roles only read the links", async () => {
    roles = ["support"];
    apps.windows = "https://apps.microsoft.com/detail/9NABCDEFGHIJ";
    shown(<AppsPage />);
    expect(await screen.findByText("https://apps.microsoft.com/detail/9NABCDEFGHIJ", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save link" })).toBeNull();
  });
});
