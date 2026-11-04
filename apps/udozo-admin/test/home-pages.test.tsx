// Site › Home pages and Sponsored: each home page (across countries, then each market) with its layout and its rows
// of blocks in the rows editor, each block showing what it will show, the live preview beside them (a click in it
// chooses a block), listings and stores picked for marquees, layouts changed keeping the rows or not, publishing and
// previews on udozo.com; personal rows (filled for each visitor) on a country's page only; Sponsored placements placed,
// refused with the field named, and ended. Support looks only.
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
const row = (id: string, blocks: unknown[], extra: Record<string, unknown> = {}) => ({ id, hidden: false, title: "", subtitle: "", viewAll: null, background: "none", image: null, width: "contained", spacing: "normal", blocks, ...extra });
const hero = { id: "h", type: "home_hero", span, hidden: false, style: "search", title: "Buy and sell near you", accent: "", subtitle: "", slides: [] };
const sponsored = { id: "s", type: "sponsored_rail", span, hidden: false, title: "Sponsored", limit: 8 };
const marquee = { id: "m", type: "listing_marquee", span, hidden: false, title: "", picks: [], fill: { by: "trending", value: null }, limit: 12, speed: "normal", direction: "left", cards: "standard" };
const page = (layout = "marketplace") => ({
  object: "home_page",
  page: "NG",
  name: "Nigeria",
  scope: "country",
  layout,
  rows: [row("r1", [hero], { width: "full" }), row("r2", [sponsored, marquee], { title: "Picked for you" })],
  published_rows: null,
  draft: [hero, sponsored, marquee],
  published_layout: null,
  published: null,
  unpublished_changes: true,
  live: false,
  version: 0,
  published_at: null,
  updated_at: "2026-11-01T10:00:00.000Z",
  versions: [],
  layouts,
  blocks_allowed: ["home_hero", "category_masonry", "deals_rail", "sponsored_rail", "top_selling_rail", "listing_group", "banner", "trust_bar", "listing_marquee", "store_marquee", "masonry_grid", "category_banner", "personal_rail"],
  sections_allowed: ["home_hero"],
});
// The page across countries. Its allowed blocks name a personal row as if the API offered one: the editor still never does.
const globalPage = () => ({
  ...page("explorer"),
  page: "global",
  name: "All countries",
  scope: "global",
  rows: [row("g1", [hero], { width: "full" })],
  draft: [hero],
  blocks_allowed: ["home_hero", "category_masonry", "sponsored_rail", "listing_group", "banner", "country_tiles", "trust_bar", "personal_rail"],
});
const cover = (n: number) => ({ url: `https://media.test/${n}.jpg`, width: 800, height: 600 });
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
    if (path === "/v1/admin/classifieds/home/global") return ok(globalPage());
    if (path === "/v1/admin/classifieds/home/NG/layout") return ok(page((body as { layout: string }).layout));
    if (path === "/v1/admin/classifieds/home/NG/draft") return ok(page());
    if (path === "/v1/admin/classifieds/home/NG/resolve" || path === "/v1/admin/classifieds/home/global/resolve") {
      const rows = (body as { rows: Array<{ id: string; blocks: Array<{ id: string; type: string; kind?: string }> }> }).rows;
      const data = (block: { type: string; kind?: string }) =>
        block.type === "listing_marquee" ? { items: [{ id: "l1", title: "Galaxy A54", cover: cover(1) }, { id: "l2", title: "iPhone 13", cover: cover(2) }] } : block.type === "sponsored_rail" ? { items: [] } : block.type === "personal_rail" ? { kind: block.kind } : { slides: [] };
      return ok({ object: "home_page_resolved", page: path.split("/")[5], rows: rows.map(item => ({ ...item, view_all_href: null, blocks: item.blocks.map(block => ({ ...block, data: data(block) })) })) });
    }
    if (path === "/v1/admin/classifieds/listings") return ok({ object: "list", data: [{ id: "x1", ref: 100031, sku: "PHN-000031", title: "Tecno Camon 20", country: "NG", status: "active", photos: [], price: { kind: "fixed", amount: 9000000, currency: "NGN" } }], total: 1, has_more: false });
    if (path === "/v1/admin/classifieds/home/NG/stores") return ok({ object: "list", data: [] });
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
  test("each page with its badge, the three layouts, and its rows of blocks, each showing what it will show", slow, async () => {
    show(<HomePagesPage />);
    const picker = await screen.findByRole("navigation", { name: "Home pages" });
    expect(within(picker).getByRole("button", { name: /All countries/ })).toBeTruthy();
    expect(within(picker).getByRole("button", { name: /Nigeria/ }).getAttribute("aria-current")).toBe("page");
    expect((await screen.findByRole("button", { name: /Classic marketplace/ })).getAttribute("aria-pressed")).toBe("true");
    // Udozo's rows and blocks, from its registry.
    const second = await screen.findByRole("region", { name: "Picked for you" }, { timeout: 10000 });
    expect(within(second).getByText("Moving listings", { selector: "button" })).toBeTruthy();
    // Each block shows what it will show (the draft filled as visitors would see it), or says it shows nothing.
    expect(await within(second).findByRole("list", { name: "Listings it will show" }, { timeout: 10000 })).toBeTruthy();
    expect(within(second).getByText(/Nothing to show here now/)).toBeTruthy();
    // The live preview: udozo.com's preview of the saved draft.
    const frame = (await screen.findByTitle("Live preview of the draft", {}, { timeout: 10000 })) as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe("https://udozo.test/home-preview?page=ng&token=123.sig");
  });

  test("a row added with a moving listings block, a listing picked for it, saved as rows", slow, async () => {
    show(<HomePagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add row" }, { timeout: 10000 }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Moving listings/ }));
    fireEvent.change(await screen.findByPlaceholderText("Search live listings"), { target: { value: "tecno" } });
    fireEvent.click(await screen.findByRole("button", { name: /Tecno Camon 20/ }, { timeout: 10000 }));
    await waitFor(
      () => {
        const saved = sent.filter(item => item.path === "/v1/admin/classifieds/home/NG/draft").at(-1)?.body as { rows: Array<{ blocks: Array<{ type: string; picks?: string[] }> }> } | undefined;
        expect(saved?.rows).toHaveLength(3);
        expect(saved!.rows[2]!.blocks[0]).toMatchObject({ type: "listing_marquee", picks: ["100031"] });
      },
      { timeout: 10000 },
    );
  });

  test("a personal row added on a country's page: its kind, title and size, saved; it says it is filled for each visitor", slow, async () => {
    show(<HomePagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Add row" }, { timeout: 10000 }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Personal listings/ }));
    const kind = (await screen.findByLabelText("Shows", {}, { timeout: 10000 })) as HTMLSelectElement;
    expect(kind.value).toBe("for_you");
    // A title still the kind's own follows the kind chosen.
    fireEvent.change(kind, { target: { value: "recent" } });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Recently viewed");
    fireEvent.change(screen.getByLabelText("Listings"), { target: { value: "8" } });
    await waitFor(
      () => {
        const saved = sent.filter(item => item.path === "/v1/admin/classifieds/home/NG/draft").at(-1)?.body as { rows: Array<{ blocks: Array<Record<string, unknown>> }> } | undefined;
        expect(saved?.rows).toHaveLength(3);
        expect(saved!.rows[2]!.blocks[0]).toMatchObject({ type: "personal_rail", kind: "recent", title: "Recently viewed", limit: 8 });
      },
      { timeout: 10000 },
    );
    // One the admin titled keeps its title when the kind changes.
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Still thinking about these?" } });
    fireEvent.change(screen.getByLabelText("Shows"), { target: { value: "price_drops" } });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Still thinking about these?");
    // Nothing to preview from the API: the card says it is filled for each visitor.
    expect(await screen.findByText(/Filled for each visitor when the page loads/, {}, { timeout: 10000 })).toBeTruthy();
  });

  test("the page across countries never offers a personal row", slow, async () => {
    search.value = new URLSearchParams("page=global");
    try {
      show(<HomePagesPage />);
      fireEvent.click(await screen.findByRole("button", { name: "Add row" }, { timeout: 10000 }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByRole("button", { name: /Countries/ })).toBeTruthy();
      expect(within(dialog).queryByRole("button", { name: /Personal listings/ })).toBeNull();
    } finally {
      search.value = new URLSearchParams("page=NG");
    }
  });

  test("a click on a block in the live preview opens its form; a message from another site does nothing", slow, async () => {
    show(<HomePagesPage />);
    const frame = (await screen.findByTitle("Live preview of the draft", {}, { timeout: 10000 })) as HTMLIFrameElement;
    window.dispatchEvent(new MessageEvent("message", { origin: "https://evil.test", source: frame.contentWindow, data: { source: "udozo-preview", type: "select", row: "r2", block: "s" } }));
    window.dispatchEvent(new MessageEvent("message", { origin: "https://udozo.test", source: frame.contentWindow, data: { source: "udozo-preview", type: "select", row: "r2", block: "s" } }));
    expect(await screen.findByText(/Shows this page’s live placements/, {}, { timeout: 10000 })).toBeTruthy();
  });

  test("a layout chosen keeping the rows, or starting from its own", slow, async () => {
    show(<HomePagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Deals first/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByLabelText(/Keep my rows/));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use this layout" }));
    await waitFor(() => expect(sent.find(item => item.path === "/v1/admin/classifieds/home/NG/layout")?.body).toEqual({ layout: "deals", replace: false }));
  });

  test("the preview opens udozo.com's page in a tab; publishing asks first", slow, async () => {
    show(<HomePagesPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Open preview" }, { timeout: 10000 }));
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
    expect(screen.queryByRole("button", { name: "Add row" })).toBeNull();
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
