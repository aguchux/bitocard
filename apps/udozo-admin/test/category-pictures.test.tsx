// Marketplace > Categories: a top category's pictures on udozo.com (8 November 2026, the owner's request), its banner
// across the top of its pages and its spotlight image on a circle beside its name. Its row says what it has; operations
// open them, upload or remove each (saved at once) and see a preview; subcategories have none.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/categories" }));

await import("@/app/api-product");
const { default: CategoriesPage } = await import("@/app/(console)/classifieds/categories/page");

let sent: Array<{ method: string; path: string; body: unknown }>;
let banner: string | null;

const category = (id: string, slug: string, name: string, sku_prefix: string, pictures: { banner_url?: string | null; spotlight_url?: string | null } = {}) => ({
  object: "classified_admin_category",
  id,
  slug,
  name,
  icon: "smartphone",
  b2b: false,
  enabled: true,
  sku_prefix,
  keywords: [],
  banner_url: null,
  spotlight_url: null,
  ...pictures,
  open: true,
  active_listings: 3,
});
const tree = () => ({
  object: "list",
  country: "NG",
  data: [
    { ...category("c-phones", "phones-tablets", "Phones and tablets", "PHT", { banner_url: banner, spotlight_url: "https://cdn.test/spot.png" }), children: [category("c-mobile", "mobile-phones", "Mobile phones", "PHN")] },
    { ...category("c-kids", "kids-baby", "Kids and baby", "KID"), children: [] },
  ],
});

beforeEach(() => {
  sent = [];
  banner = "https://cdn.test/banner.webp";
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles: ["operations"] }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/media/settings") {
      return ok({ object: "media_settings", configured: true, purposes: ["classified_category_banner", "classified_category_spotlight"].map(purpose => ({ purpose, label: purpose, max_bytes: 3_000_000, content_types: ["image/png", "image/jpeg", "image/webp"] })) });
    }
    if (url.pathname === "/v1/admin/classifieds/categories") return ok(tree());
    if (url.pathname === "/v1/admin/classifieds/categories/c-phones" && input.method === "PATCH") {
      if (body && typeof body === "object" && "banner_url" in body) banner = (body as { banner_url: string | null }).banner_url;
      return ok({ object: "classified_admin_category", id: "c-phones", slug: "phones-tablets", banner_url: banner, spotlight_url: "https://cdn.test/spot.png" });
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

describe("category pictures", () => {
  test("top categories say what pictures they have; subcategories have none", slow, async () => {
    show();
    expect(await screen.findByRole("button", { name: "Phones and tablets: Banner and spotlight, open the pictures" }, slow)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Kids and baby: No pictures, open the pictures" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Mobile phones: .*pictures/ })).toBeNull();
  });

  test("opened, both uploads and a preview; removing the banner saves it at once", slow, async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Phones and tablets: Banner and spotlight/ }, slow));
    expect(screen.getByText("Banner")).toBeTruthy();
    expect(screen.getByText("Spotlight image")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Phones and tablets: preview of its banner and spotlight image" })).toBeTruthy();
    const remove = await screen.findAllByRole("button", { name: "Remove" }, slow);
    fireEvent.click(remove[0]!);
    await waitFor(() => expect(sent.filter(item => item.method === "PATCH").map(item => item.body)).toEqual([{ banner_url: null }]), slow);
    expect(await screen.findByText("The banner is taken off.", {}, slow)).toBeTruthy();
  });
});
