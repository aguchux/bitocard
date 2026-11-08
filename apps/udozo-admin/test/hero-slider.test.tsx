// Site › Hero slider: the columns sliding past at the top of udozo.com's home pages. Operations add a column (its
// split, each banner's image, words and link), turn it on and off, move it along the reel and delete it; support only
// sees them.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/hero-slider" }));

await import("@/app/api-product");
const { default: HeroSliderPage } = await import("@/app/(console)/hero-slider/page");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const tile = (id: string, slot: number, extra = {}) => ({
  id,
  slot,
  image_url: `https://cdn.udozo.test/platform/hero/images/${id}.jpg`,
  alt: `Banner ${id}`,
  ad: true,
  link: { kind: "listing", target: "100123", label: "iPhone 13 128GB", href: "/ng/l/100123-iphone-13" },
  ...extra,
});
const slide = (id: string, extra = {}) => ({
  object: "hero_slide",
  id,
  country: null,
  layout: "full",
  position: 0,
  tiles: [tile(`${id}-t`, 0)],
  enabled: true,
  state: "showing",
  starts_at: null,
  ends_at: null,
  note: null,
  created_at: "2026-11-08T00:00:00.000Z",
  updated_at: "2026-11-08T00:00:00.000Z",
  ...extra,
});
const existing = [
  slide("s1"),
  slide("s2", { layout: "third_two_thirds", position: 1, tiles: [tile("top", 0), tile("bottom", 1, { link: { kind: "seller", target: "gone_seller", label: "Bisi A.", href: null } })] }),
];

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
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname + url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/classifieds/home") return ok({ object: "list", data: [{ page: "global", name: "All countries", scope: "global" }, { page: "NG", name: "Nigeria", scope: "country" }] });
    if (url.pathname === "/v1/admin/media/settings") return ok({ object: "media_settings", configured: true, purposes: [{ purpose: "hero_image", content_types: ["image/png", "image/jpeg"], max_bytes: 3_000_000 }] });
    if (url.pathname === "/v1/admin/classifieds/hero-slides" && input.method === "GET") return ok({ object: "list", scope: url.searchParams.get("scope"), data: existing });
    if (url.pathname === "/v1/admin/classifieds/hero-slides" && input.method === "POST") return ok(slide("s3", body as object), 201);
    if (url.pathname === "/v1/admin/classifieds/hero-slides/targets") {
      const kind = url.searchParams.get("kind");
      const q = url.searchParams.get("q") ?? "";
      const options =
        kind === "listing"
          ? [{ value: "100123", label: "iPhone 13 128GB", detail: "No. 100123 · PHN-000123 · ₦450,000 · NG", image_url: null }, { value: "100124", label: "iPhone 13 Pro", detail: "No. 100124 · NG", image_url: null }]
          : kind === "category"
            ? [{ value: "mobile-phones", label: "Mobile phones", detail: "In Phones and tablets · mobile-phones", image_url: null }]
            : [];
      return ok({ object: "list", kind, data: options.filter(option => option.label.toLowerCase().includes(q.toLowerCase())) });
    }
    if (url.pathname === "/v1/admin/classifieds/hero-slides/order") return ok({ object: "list", scope: "global", data: existing });
    if (url.pathname.startsWith("/v1/admin/classifieds/hero-slides/") && input.method === "PATCH") return ok({ ...existing[0], ...(body as object) });
    return ok({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, 404);
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
        <HeroSliderPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };

describe("hero slider", () => {
  test("the columns in order with their banners and links; a gone link is pointed out; the switch and moving along", long, async () => {
    show();
    expect((await screen.findAllByAltText("Banner s1-t", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("A third over two thirds").length).toBeGreaterThan(0);
    expect(screen.getByText(/gone_seller: gone, shown without a link|Bisi A\.: gone, shown without a link/)).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Show column 1" }));
    await waitFor(() => expect(sent.find(item => item.method === "PATCH")).toEqual({ method: "PATCH", path: "/v1/admin/classifieds/hero-slides/s1", body: { enabled: false } }), slow);
    fireEvent.click(screen.getByRole("button", { name: "Move column 1 later" }));
    await waitFor(() => expect(sent.find(item => item.path === "/v1/admin/classifieds/hero-slides/order")?.body).toEqual({ scope: "global", ids: ["s2", "s1"] }), slow);
  });

  test("operations add a column: a split, then each banner's words and link, in the order chosen", long, async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add column" }, slow));
    const dialog = await screen.findByRole("dialog", {}, slow);
    fireEvent.change(within(dialog).getByLabelText("Market"), { target: { value: "NG" } });
    fireEvent.click(within(dialog).getByLabelText("Two thirds over a third"));
    expect(within(dialog).getByText(/Best 900 × 660 px/)).toBeTruthy();
    expect(within(dialog).getByText(/Best 900 × 330 px/)).toBeTruthy();
    const words = within(dialog).getAllByLabelText("What the banner says");
    fireEvent.change(words[0]!, { target: { value: "Phones from ₦50,000" } });
    fireEvent.change(words[1]!, { target: { value: "Meet Adaeze" } });
    const kinds = within(dialog).getAllByLabelText("Links to");
    fireEvent.change(kinds[0]!, { target: { value: "brand" } });
    fireEvent.change(within(dialog).getByLabelText("Brand"), { target: { value: "samsung" } });
    fireEvent.change(kinds[1]!, { target: { value: "seller" } });
    fireEvent.change(within(dialog).getByLabelText("Seller"), { target: { value: "adaeze_gadgets" } });
    // The small one goes on top instead.
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Move up" })[1]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST")).toBe(true), slow);
    expect(sent.find(item => item.method === "POST")?.body).toMatchObject({
      country: "NG",
      layout: "two_thirds_third",
      tiles: [
        { alt: "Meet Adaeze", link: { kind: "seller", target: "adaeze_gadgets" }, ad: true },
        { alt: "Phones from ₦50,000", link: { kind: "brand", target: "samsung" }, ad: true },
      ],
      enabled: true,
    });
  });

  test("a listing and a category are chosen from suggestions as the admin types", long, async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add column" }, slow));
    const dialog = await screen.findByRole("dialog", {}, slow);
    fireEvent.change(within(dialog).getByLabelText("What the banner says"), { target: { value: "iPhone deals" } });
    const listing = within(dialog).getByRole("combobox", { name: "Listing" });
    fireEvent.focus(listing);
    fireEvent.change(listing, { target: { value: "iphone" } });
    const suggestions = () => within(within(dialog).getByRole("listbox", { name: "Suggestions" })).getAllByRole("option");
    await waitFor(() => expect(suggestions().length).toBe(2), slow);
    expect(sent.some(item => item.path === "/v1/admin/classifieds/hero-slides/targets?kind=listing&q=iphone&scope=global")).toBe(true);
    fireEvent.keyDown(listing, { key: "ArrowDown" });
    fireEvent.keyDown(listing, { key: "ArrowDown" });
    expect(suggestions()[1]!.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(listing, { key: "Enter" });
    expect((listing as HTMLInputElement).value).toBe("100124");
    expect(within(dialog).getByText("iPhone 13 Pro")).toBeTruthy();
    expect(within(dialog).queryByRole("listbox")).toBeNull();

    // Now a category, chosen with the mouse.
    fireEvent.change(within(dialog).getByLabelText("Links to"), { target: { value: "category" } });
    const category = within(dialog).getByRole("combobox", { name: "Category" });
    expect((category as HTMLInputElement).value).toBe("");
    fireEvent.focus(category);
    fireEvent.change(category, { target: { value: "mob" } });
    fireEvent.mouseDown(await within(dialog).findByRole("option", { name: /Mobile phones/ }, slow));
    expect((category as HTMLInputElement).value).toBe("mobile-phones");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add column" }));
    await waitFor(() => expect(sent.find(item => item.method === "POST")?.body).toMatchObject({ layout: "full", tiles: [{ alt: "iPhone deals", link: { kind: "category", target: "mobile-phones" } }] }), slow);
  });

  test("support sees the columns and cannot change them", long, async () => {
    roles = ["support"];
    show();
    expect((await screen.findAllByAltText("Banner s1-t", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getByText("Only operations admins add and change the hero slider.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add column" })).toBeNull();
    expect((screen.getByRole("switch", { name: "Show column 1" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
