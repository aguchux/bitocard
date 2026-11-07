// Marketplace > Brand registry: the brands with their logos (bundled, uploaded or initials), searched and filtered a
// page at a time; a brand changed (name, search words, colour, categories) or added, and turned off; sellers' new
// brands added (their categories ticked) or dismissed. Support looks, never changes.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/brands" }));

await import("@/app/api-product");
const { default: BrandsPage } = await import("@/app/(console)/classifieds/brands/page");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const brand = (slug: string, name: string, extra: Record<string, unknown> = {}) => ({
  object: "classified_brand",
  id: `id-${slug}`,
  slug,
  name,
  aliases: [],
  logo_url: null,
  logo_source: null,
  bundled_logo_url: null,
  uploaded_logo_url: null,
  banner_url: null,
  color: null,
  enabled: true,
  categories: [{ id: "c-phones", slug: "mobile-phones", name: "Mobile phones" }],
  listings: 0,
  updated_at: "2026-11-01T10:00:00.000Z",
  ...extra,
});
const samsung = brand("samsung", "Samsung", { aliases: ["galaxy"], logo_url: "https://udozo.com/brand-logos/samsung.svg", logo_source: "bundled", bundled_logo_url: "https://udozo.com/brand-logos/samsung.svg", color: "#1428A0", listings: 12 });
const tecno = brand("tecno", "Tecno", { listings: 4 });
const categories = {
  object: "list",
  country: "NG",
  data: [
    {
      object: "classified_admin_category",
      id: "c-top",
      slug: "phones-tablets",
      name: "Phones and tablets",
      icon: "smartphone",
      b2b: false,
      enabled: true,
      open: true,
      active_listings: 3,
      children: [
        { object: "classified_admin_category", id: "c-phones", slug: "mobile-phones", name: "Mobile phones", icon: "smartphone", b2b: false, enabled: true, open: true, active_listings: 3 },
        { object: "classified_admin_category", id: "c-tablets", slug: "tablets", name: "Tablets", icon: "tablet", b2b: false, enabled: true, open: true, active_listings: 0 },
      ],
    },
  ],
};
const suggestion = { object: "classified_brand_suggestion_group", name_key: "zenphone", name: "Zenphone", sellers: 2, categories: [{ id: "c-phones", slug: "mobile-phones", name: "Mobile phones" }], first_at: "2026-11-01T09:00:00.000Z", last_at: "2026-11-01T10:00:00.000Z" };

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (given: Request | string, init?: RequestInit) => {
    // RTK Query sends a Request; a file's bytes go through apiFetch as fetch(url, init).
    const input = typeof given === "string" ? { url: given, method: init?.method ?? "GET", json: async () => null } : given;
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: `${url.pathname}${url.search}`, body });
    const path = url.pathname;
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/media/settings") return ok({ object: "media_settings", configured: true, purposes: [{ purpose: "classified_brand_banner", label: "Marketplace brand banner", max_bytes: 3145728, content_types: ["image/png", "image/jpeg", "image/webp"] }, { purpose: "classified_brand_logo", label: "Marketplace brand logo", max_bytes: 1048576, content_types: ["image/png", "image/svg+xml"] }] });
    if (path === "/v1/admin/media/uploads") return ok({ object: "media_upload", id: "m1", upload: { method: "PUT", url: "https://storage.test/k", headers: {} } }, 201);
    if (path === "/v1/admin/media/m1/content") return ok({ object: "media_asset", id: "m1", url: "https://media.test/samsung-banner.jpg", status: "ready" });
    if (path === "/v1/admin/media") return ok({ object: "list", data: [], has_more: false });
    if (path === "/v1/admin/classifieds/categories") return ok(categories);
    if (path === "/v1/admin/classifieds/brands" && input.method === "GET") return ok({ object: "list", data: url.searchParams.get("logo") === "missing" ? [tecno] : [samsung, tecno], total: 120, offset: Number(url.searchParams.get("offset") ?? 0), limit: 50 });
    if (path === "/v1/admin/classifieds/brands") return ok({ ...brand("zenphone", (body as { name: string }).name), listings_renamed: 2, suggestions_answered: 2 }, 201);
    if (path === "/v1/admin/classifieds/brands/samsung") return ok({ ...samsung, ...(body as object), listings_renamed: 0, suggestions_answered: 0 });
    if (path === "/v1/admin/classifieds/brand-suggestions") return ok({ object: "list", data: [suggestion] });
    if (path === "/v1/admin/classifieds/brand-suggestions/dismiss") return ok({ object: "classified_brand_suggestion_group", name_key: "zenphone", dismissed: 2 });
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
        <BrandsPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const lastBody = (method: string, path: string) => [...sent].reverse().find(item => item.method === method && item.path === path)?.body;

describe("Brand registry", () => {
  test("the brands with their logos and where each logo comes from, a page at a time, filtered", slow, async () => {
    show();
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Samsung")).toBeTruthy();
    expect(within(table).getByText("galaxy")).toBeTruthy();
    expect(within(table).getByText("Bundled")).toBeTruthy();
    expect(within(table).getByText("Initials")).toBeTruthy();
    expect(table.querySelector('img[src="https://udozo.com/brand-logos/samsung.svg"]')).toBeTruthy();
    expect(screen.getByText("1–50 of 120")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(sent.some(item => item.path.includes("/v1/admin/classifieds/brands?") && item.path.includes("offset=50"))).toBe(true));
    fireEvent.change(screen.getByLabelText("Logo"), { target: { value: "missing" } });
    await waitFor(() => expect(sent.some(item => item.path.includes("logo=missing") && item.path.includes("offset=0"))).toBe(true));
  });

  test("a brand changed: its name, search words, colour and categories", slow, async () => {
    show();
    fireEvent.click(await within(await screen.findByRole("table")).findByRole("button", { name: /Samsung/ }));
    fireEvent.change(await screen.findByLabelText("Search words"), { target: { value: "galaxy, galaxy note" } });
    // Its banner is uploaded here, beside the logo, with the size it should be.
    expect(screen.getByText(/Best 1600 × 400 pixels \(4:1\), at least 600 × 150/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "#0a0a0a" } });
    fireEvent.click(screen.getByLabelText("Tablets"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lastBody("PATCH", "/v1/admin/classifieds/brands/samsung")).toEqual({ name: "Samsung", aliases: ["galaxy", "galaxy note"], color: "#0A0A0A", category_ids: ["c-phones", "c-tablets"], logo_url: null, banner_url: null }));
    expect(await screen.findByText("Saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(lastBody("PATCH", "/v1/admin/classifieds/brands/samsung")).toEqual({ enabled: false }));
  });

  test("a banner is saved as soon as it is uploaded, on its own", slow, async () => {
    show();
    fireEvent.click(await within(await screen.findByRole("table")).findByRole("button", { name: /Samsung/ }));
    const file = new File([new Uint8Array(32)], "banner.jpg", { type: "image/jpeg" });
    fireEvent.change(await screen.findByLabelText("Banner file"), { target: { files: [file] } });
    await waitFor(() => expect(lastBody("PATCH", "/v1/admin/classifieds/brands/samsung")).toEqual({ banner_url: "https://media.test/samsung-banner.jpg" }));
    expect(await screen.findByText("The banner is saved. It shows on udozo.com within a few minutes.")).toBeTruthy();
    expect(sent.some(item => item.path === "/v1/admin/media/m1/content")).toBe(true);
  });

  test("sellers' new brand added with their categories ticked, or dismissed", slow, async () => {
    show();
    const waiting = (await screen.findByText("Zenphone")).closest("li")!;
    fireEvent.click(within(waiting as HTMLElement).getByRole("button", { name: "Add" }));
    expect((await screen.findByLabelText("Name") as HTMLInputElement).value).toBe("Zenphone");
    expect((screen.getByLabelText("Mobile phones") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText("Save the brand first, then upload its logo and banner.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add brand" }));
    await waitFor(() => expect(lastBody("POST", "/v1/admin/classifieds/brands")).toEqual({ name: "Zenphone", aliases: [], color: null, category_ids: ["c-phones"] }));
    fireEvent.click(within((await screen.findByText("Zenphone", { selector: "span" })).closest("li") as HTMLElement).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(lastBody("POST", "/v1/admin/classifieds/brand-suggestions/dismiss")).toEqual({ name_key: "zenphone" }));
  });

  test("support looks, never changes", slow, async () => {
    roles = ["support"];
    show();
    fireEvent.click(await within(await screen.findByRole("table")).findByRole("button", { name: /Samsung/ }));
    expect((await screen.findByLabelText("Name")).closest("fieldset")!.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "New brand" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });
});
