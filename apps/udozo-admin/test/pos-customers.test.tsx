import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

// admin.udozo.com > POS > an account: the shop's own customers (no Udozo account needed), read by Udozo's team under
// the shop's account, with what each owes the shop and, for those linked to Udozo, their rating on Udozo in words.
const params: Record<string, string> = { id: "acc1" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/pos/accounts",
}));

await import("@/app/api-product");
const { default: AccountPage } = await import("@/app/(console)/pos/accounts/[id]/page");
const { default: CustomerPage } = await import("@/app/(console)/pos/accounts/[id]/customers/[customer]/page");
const { udozoRatingWords } = await import("@/components/pos-customers");

const slow = { timeout: 10000 };
const plan = { object: "pos_plan", code: "premium", name: "Premium", description: null, price: null, available: true, paid: true, limits: { products: null, shops: 1, tills: 3, staff: null }, trial_days: 14, shown: true, prices: { NGN: 1_500_000 }, accounts: 1 };
const account = {
  object: "pos_account",
  id: "acc1",
  country: "NG",
  currency: "NGN",
  mode: "live",
  status: "active",
  plan,
  next_plan: null,
  trial_ends_at: null,
  period_start: "2026-11-01T00:00:00.000Z",
  period_end: "2026-12-01T00:00:00.000Z",
  past_due_since: null,
  drops_to_free_at: null,
  lapsed_plan: null,
  limits: plan.limits,
  shops: [{ object: "pos_shop", id: "s1", name: "Ada's Gadget Hub", address: "3 Allen Avenue", phone: null, tin: null, shop_code: "AGH-4821", vat_bps: 750, receipt_footer: null, tills: [] }],
  created_at: "2026-11-01T00:00:00.000Z",
  owner: { id: "c1", name: "Ada Okafor", email: "ada@example.com" },
  charges: [],
};
const brief = (over: Record<string, unknown> = {}) => ({ object: "pos_customer", id: "pc1", number: "C-000001", name: "Bola Ade", phone: "+2348031234567", email: null, udozo: false, owed: 250_000, credit_limit: 500_000, sales_count: 3, spent: 900_000, last_sale_at: "2026-11-10T09:00:00.000Z", ...over });
const linked = brief({ id: "pc2", number: "C-000002", name: "Chidi Eze", udozo: true, owed: 0, credit_limit: null, sales_count: 1, spent: 120_000 });

let sent: Array<{ path: string; search: string }>;

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    sent.push({ path: url.pathname, search: url.search });
    const ok = (value: unknown) => Response.json(value);
    const path = url.pathname;
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ade Bello", email: "ade@udozo.com", roles: ["support"] }, step_up_until: null });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/pos/accounts/acc1") return ok(account);
    if (path === "/v1/admin/pos/accounts/acc1/customers") {
      const data = url.searchParams.get("owing") === "true" ? [brief()] : [brief(), linked];
      return ok({ object: "list", summary: { owing: 1, owed: 250_000 }, total: data.length, has_more: false, data });
    }
    if (path === "/v1/admin/pos/accounts/acc1/customers/pc2")
      return ok({
        ...linked,
        address: "12 Broad Street",
        notes: "Prefers transfers.",
        source: "udozo",
        udozo_rating: { member_since: "2025-03-01T00:00:00.000Z", in_good_standing: true, reviews: { positive: 9, neutral: 0, negative: 1, counted: 10, positive_pct: 90 }, scores: { band: "Very good" } },
        created_at: "2026-11-05T00:00:00.000Z",
        sales: [{ id: "sale1", number: "S-000004", status: "completed", total: 120_000, currency: "NGN", created_at: "2026-11-05T10:00:00.000Z" }],
        entries: [
          { id: "e2", kind: "repayment", amount: -50_000, owed_after: 0, sale: null, method: "cash", reference: null, note: null, by: "Ada Okafor", created_at: "2026-11-06T10:00:00.000Z" },
          { id: "e1", kind: "credit_sale", amount: 50_000, owed_after: 50_000, sale: { id: "sale1", number: "S-000004" }, method: null, reference: null, note: null, by: "Ada Okafor", created_at: "2026-11-05T10:00:00.000Z" },
        ],
      });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete params.customer;
});

const shown = (children: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{children}</AdminGate>
    </AdminProviders>,
  );

describe("POS customers in admin", () => {
  test("an account lists its shop's customers, what they owe, and who is linked to Udozo", async () => {
    shown(<AccountPage />);
    const bola = (await screen.findByText("Bola Ade", {}, slow)).closest("a")!;
    expect(bola.getAttribute("href")).toBe("/pos/accounts/acc1/customers/pc1");
    expect(bola.textContent).toContain("C-000001");
    expect(bola.textContent).toContain("3 sales");
    expect(bola.textContent).toContain("Owes");
    expect(bola.textContent).not.toContain("Udozo");
    const chidi = screen.getByText("Chidi Eze").closest("a")!;
    expect(chidi.textContent).toContain("Udozo");
    expect(chidi.textContent).toContain("spent");
    expect(screen.getByText(/2 customers · 1 owe the shop/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Only those who owe the shop"));
    await waitFor(() => expect(screen.queryByText("Chidi Eze")).toBeNull(), slow);
    expect(sent.some(item => item.path.endsWith("/customers") && item.search.includes("owing=true"))).toBe(true);
  });

  test("a customer shows their details, sales, what they owed line by line and their rating on Udozo", async () => {
    params.customer = "pc2";
    shown(<CustomerPage />);
    expect(await screen.findByText("Linked to Udozo", {}, slow)).toBeTruthy();
    expect(screen.getByText("12 Broad Street")).toBeTruthy();
    expect(screen.getByText(/by paying through Udozo/)).toBeTruthy();
    expect(screen.getByText("Prefers transfers.")).toBeTruthy();
    expect(screen.getByText("90% positive from 10 reviews · Very good · on Udozo since March 2025")).toBeTruthy();
    expect(screen.getByText(/Bought on credit .*\(S-000004\)/)).toBeTruthy();
    expect(screen.getByText(/Paid back .* · cash/)).toBeTruthy();
    expect(screen.getByText("S-000004")).toBeTruthy();
    expect(await screen.findByText(/A customer of Ada's Gadget Hub/, {}, slow)).toBeTruthy();
  });

  test("the rating says when there are too few reviews and when the account is suspended", () => {
    expect(udozoRatingWords({ member_since: "2026-01-15T00:00:00.000Z", in_good_standing: false, reviews: { positive: 1, neutral: 0, negative: 0, counted: 1, positive_pct: null }, scores: null })).toBe("1 review · on Udozo since January 2026 · Udozo account suspended");
    expect(udozoRatingWords({ member_since: "2026-01-15T00:00:00.000Z", in_good_standing: true, reviews: null, scores: null })).toBe("on Udozo since January 2026");
  });
});
