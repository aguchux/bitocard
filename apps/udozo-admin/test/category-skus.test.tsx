// Marketplace > Categories: every category shows its SKU prefix; operations change it (three letters, the API's refusal
// shown when another category has it), support only sees it; and ads show their SKU beside their number.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/categories" }));

await import("@/app/api-product");
const { default: CategoriesPage } = await import("@/app/(console)/classifieds/categories/page");
const { ListingCell } = await import("@/components/classifieds");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const category = (id: string, slug: string, name: string, sku_prefix: string) => ({ object: "classified_admin_category", id, slug, name, icon: "smartphone", b2b: false, enabled: true, sku_prefix, open: true, active_listings: 3 });
const tree = () => ({ object: "list", country: "NG", data: [{ ...category("c-top", "phones-tablets", "Phones and tablets", "PHT"), children: [category("c-phones", "mobile-phones", "Mobile phones", "PHN"), category("c-tabs", "tablets", "Tablets", "TAB")] }] });

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/classifieds/categories") return ok(tree());
    if (url.pathname === "/v1/admin/classifieds/categories/c-tabs" && input.method === "PATCH") {
      const prefix = (body as { sku_prefix: string }).sku_prefix;
      if (prefix === "PHN") return ok({ error: { type: "conflict_error", code: "sku_prefix_taken", message: "PHN is already Mobile phones's, now or before. Choose another.", param: "sku_prefix" } }, 409);
      return ok({ object: "classified_admin_category", id: "c-tabs", slug: "tablets", enabled: true, sku_prefix: prefix });
    }
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
        <CategoriesPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };

describe("SKU prefixes", () => {
  test("each category shows its three letters; operations change one, and a prefix another category has is refused in words", slow, async () => {
    show();
    const tabs = await screen.findByRole("button", { name: "Tablets: SKU prefix TAB, change it" }, slow);
    expect(screen.getByRole("button", { name: "Mobile phones: SKU prefix PHN, change it" })).toBeTruthy();
    fireEvent.click(tabs);
    const box = screen.getByLabelText("Tablets: SKU prefix") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "ph1n" } });
    // Letters only, in capitals.
    expect(box.value).toBe("PHN");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/PHN is already Mobile phones's/, {}, slow)).toBeTruthy();
    fireEvent.change(box, { target: { value: "tb" } });
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "tbl" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Tablets: SKU prefix")).toBeNull(), slow);
    expect(sent.filter(item => item.method === "PATCH").map(item => item.body)).toEqual([{ sku_prefix: "PHN" }, { sku_prefix: "TBL" }]);
  });

  test("support sees the prefixes and cannot change them", slow, async () => {
    roles = ["support"];
    show();
    expect(await screen.findByText("TAB", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /SKU prefix TAB/ })).toBeNull();
  });

  test("an ad shows its SKU beside its number", () => {
    render(
      <AdminProviders>
        <ListingCell listing={{ id: "l1", ref: 100042, sku: "PHN-000123", title: "iPhone 13" }} />
      </AdminProviders>,
    );
    expect(screen.getByText("#100042")).toBeTruthy();
    expect(screen.getByText("· PHN-000123")).toBeTruthy();
  });
});
