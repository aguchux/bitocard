// Site › Home pages and Sponsored: each home page (across countries, then each market) with its layout and its
// sections in the shared editor, layouts changed with a choice to keep the sections, publishing and previews on
// udozo.com; Sponsored placements placed, refused with the field named, and ended. Support looks, never changes.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const search = { value: new URLSearchParams("page=NG") };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => search.value, usePathname: () => "/home-pages" }));

await import("@/app/api-product");
const { default: HomePagesPage } = await import("@/app/(console)/home-pages/page");
const { default: SponsoredPage } = await import("@/app/(console)/sponsored/page");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;
let opened: { location: { href: string }; close: () => void } | null;

const layouts = [
  { key: "marketplace", name: "Classic marketplace", description: "Search first, then categories.", look: { hero: "navy", cards: "standard", corners: "soft", density: "comfortable" } },
  { key: "deals", name: "Deals first", description: "A carousel of offers.", look: { hero: "brand", cards: "compact", corners: "soft", density: "compact" } },
  { key: "explorer", name: "Explore the world", description: "Built around the countries.", look: { hero: "light", cards: "large", corners: "round", density: "airy" } },
];
const span = { lg: 12, md: 6, rows: 1 };
const page = (layout = "marketplace") => ({
  object: "home_page",
  page: "NG",
  name: "Nigeria",
  scope: "country",
  layout,
  draft: [
    { id: "h", type: "home_hero", span, hidden: false, style: "search", title: "Buy and sell near you", accent: "", subtitle: "", slides: [] },
    { id: "s", type: "sponsored_rail", span, hidden: false, title: "Sponsored", limit: 8 },
  ],
  published_layout: null,
  published: null,
  unpublished_changes: true,
  live: false,
  version: 0,
  published_at: null,
  updated_at: "2026-11-01T10:00:00.000Z",
  versions: [],
  layouts,
  sections_allowed: ["home_hero", "category_masonry", "deals_rail", "sponsored_rail", "top_selling_rail", "listing_group", "banner", "trust_bar"],
});
const pages = { object: "list", data: [{ object: "home_page_summary", page: "global", name: "All countries", scope: "global", layout: "explorer", live: false, version: 0, unpublished_changes: true }, { object: "home_page_summary", page: "NG", name: "Nigeria", scope: "country", layout: "marketplace", live: true, version: 2, unpublished_changes: false }] };
const placement = { object: "sponsored_placement", id: "p1", country: "NG", state: "active", position: 0, starts_at: "2026-11-01T00:00:00.000Z", ends_at: "2026-11-08T00:00:00.000Z", ended_at: null, note: null, listing: { ref: 100028, title: "Mercedes Benz pedal", country: "NG", live: true, card: null }, created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z" };

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  opened = null;
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
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/classifieds/categories") return ok({ object: "list", country: "NG", data: [{ object: "classified_admin_category", id: "c1", slug: "phones-tablets", name: "Phones and tablets", icon: "smartphone", b2b: false, enabled: true, open: true, active_listings: 3, children: [] }] });
    if (path === "/v1/admin/classifieds/home") return ok(pages);
    if (path === "/v1/admin/classifieds/home/NG") return ok(page());
    if (path === "/v1/admin/classifieds/home/NG/layout") return ok(page((body as { layout: string }).layout));
    if (path === "/v1/admin/classifieds/home/NG/draft") return ok(page());
    if (path === "/v1/admin/classifieds/home/NG/preview") return ok({ object: "home_preview", page: "NG", token: "123.sig", expires_at: "2026-11-01T11:00:00.000Z" });
    if (path === "/v1/admin/classifieds/home/NG/publish") return ok({ ...page(), live: true, version: 1, unpublished_changes: false });
    if (path === "/v1/admin/classifieds/sponsored" && input.method === "GET") return ok({ object: "list", data: [placement] });
    if (path === "/v1/admin/classifieds/sponsored") {
      if ((body as { listing_ref: number }).listing_ref === 999) return Response.json({ error: { type: "invalid_request_error", code: "listing_not_live", message: "Only a listing for sale on Udozo can be sponsored.", param: "listing_ref" } }, { status: 400 });
      return Response.json({ ...placement, id: "p2" }, { status: 201 });
    }
    if (path === "/v1/admin/classifieds/sponsored/p1/end") return ok({ ...placement, state: "ended", ended_at: "2026-11-01T12:00:00.000Z" });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (element: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{element}</AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };

describe("Home pages", () => {
  test("each page with its badge, the three layouts, and the page's sections in the editor", slow, async () => {
    show(<HomePagesPage />);
    const picker = await screen.findByRole("navigation", { name: "Home pages" });
    expect(within(picker).getByRole("button", { name: /All countries/ })).toBeTruthy();
    expect(within(picker).getByRole("button", { name: /Nigeria/ }).getAttribute("aria-current")).toBe("page");
    expect(await screen.findByRole("button", { name: /Classic marketplace/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Classic marketplace/ }).getAttribute("aria-pressed")).toBe("true");
    // Udozo's own sections, from its registry.
    expect(await screen.findByText("1. Hero", {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getByText("2. Sponsored")).toBeTruthy();
    expect(screen.getByText("Sponsored placements · up to 8")).toBeTruthy();
  });

  test("a layout chosen keeping the sections, or starting from its own", slow, async () => {
    show(<HomePagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Deals first/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/Keep my sections/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this layout" }));
    await waitFor(() => expect(sent.find(item => item.path === "/v1/admin/classifieds/home/NG/layout")?.body).toEqual({ layout: "deals", replace: false }));
  });

  test("the preview opens udozo.com's page with the page's own link; publishing asks first", slow, async () => {
    show(<HomePagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Preview" }, { timeout: 10000 }));
    await waitFor(() => expect(opened?.location.href).toBe("https://udozo.test/home-preview?page=ng&token=123.sig"));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Publish" }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/classifieds/home/NG/publish")).toBe(true));
  });

  test("support looks and previews, but never changes a page", slow, async () => {
    roles = ["support"];
    show(<HomePagesPage />);
    expect(await screen.findByText("Only operations admins change home pages. You can look and preview.")).toBeTruthy();
    expect((await screen.findByRole("button", { name: /Deals first/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Sponsored", () => {
  test("placements listed by page, a listing placed, a refusal shown on its field, one ended", slow, async () => {
    show(<SponsoredPage />);
    // The table (DataTable also draws phone cards).
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Mercedes Benz pedal (100028)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Place a listing" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Listing number"), { target: { value: "999" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place it" }));
    expect(await within(dialog).findByText("Only a listing for sale on Udozo can be sponsored.")).toBeTruthy();
    const refused = sent.find(item => item.method === "POST" && item.path === "/v1/admin/classifieds/sponsored");
    expect(refused?.body).toMatchObject({ listing_ref: 999, country: "NG", position: 0 });

    fireEvent.change(within(dialog).getByLabelText("Listing number"), { target: { value: "100028" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Place it" }));
    await waitFor(() => expect(sent.filter(item => item.method === "POST" && item.path === "/v1/admin/classifieds/sponsored")).toHaveLength(2));

    fireEvent.click(within(screen.getByRole("table")).getByRole("button", { name: "End now" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "End now" }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/admin/classifieds/sponsored/p1/end")).toBe(true));
  });
});
