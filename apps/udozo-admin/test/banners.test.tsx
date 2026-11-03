// Site › Banners: banner ads on udozo.com. Operations add one (place, market, image, link, what it says), switch it on
// and off from the list (the gate) and delete it; support only sees them.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/banners" }));

await import("@/app/api-product");
const { default: BannersPage } = await import("@/app/(console)/banners/page");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const existing = {
  object: "banner",
  id: "b1",
  position: "account_rail",
  country: "NG",
  image_url: "https://cdn.udozo.test/platform/banners/images/a.png",
  href: "/ng/c/mobile-phones",
  alt: "Phones from ₦50,000",
  enabled: true,
  state: "showing",
  starts_at: null,
  ends_at: null,
  note: null,
  created_at: "2026-11-03T00:00:00.000Z",
  updated_at: "2026-11-03T00:00:00.000Z",
};

// jsdom has no modal dialogs: open and close them as browsers do.
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
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/classifieds/home") return ok({ object: "list", data: [{ page: "global", name: "All countries", scope: "global" }, { page: "NG", name: "Nigeria", scope: "country" }, { page: "GH", name: "Ghana", scope: "country" }] });
    if (url.pathname === "/v1/admin/media/settings") return ok({ object: "media_settings", configured: true, purposes: [{ purpose: "banner_image", content_types: ["image/png", "image/jpeg"], max_bytes: 2_000_000 }] });
    if (url.pathname === "/v1/admin/classifieds/banners" && input.method === "GET") return ok({ object: "list", data: [existing] });
    if (url.pathname === "/v1/admin/classifieds/banners" && input.method === "POST") return ok({ ...existing, id: "b2", ...(body as object) }, 201);
    if (url.pathname === "/v1/admin/classifieds/banners/b1" && input.method === "PATCH") return ok({ ...existing, ...(body as object) });
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
        <BannersPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };

describe("banners", () => {
  test("each banner shows its place, market and state; the switch turns it off", long, async () => {
    show();
    expect((await screen.findAllByAltText("Phones from ₦50,000", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Account pages, above the menu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nigeria").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Showing").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("switch", { name: "Show the banner “Phones from ₦50,000”" })[0]!);
    await waitFor(() => expect(sent.find(item => item.method === "PATCH")).toEqual({ method: "PATCH", path: "/v1/admin/classifieds/banners/b1", body: { enabled: false } }), slow);
  });

  test("operations add one with its place, market, image, link and words", long, async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Add banner" }, slow));
    const dialog = await screen.findByRole("dialog", {}, slow);
    expect(within(dialog).getByText(/Upload 480 px wide/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("Market"), { target: { value: "GH" } });
    fireEvent.change(within(dialog).getByLabelText("Link"), { target: { value: "https://partner.example.com/offer" } });
    fireEvent.change(within(dialog).getByLabelText("What the banner says"), { target: { value: "Solar panels, 20% off" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add banner" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path === "/v1/admin/classifieds/banners")).toBe(true), slow);
    expect(sent.find(item => item.method === "POST")?.body).toMatchObject({ position: "account_rail", country: "GH", href: "https://partner.example.com/offer", alt: "Solar panels, 20% off", enabled: true, starts_at: null, ends_at: null, note: null });
  });

  test("support sees the banners and cannot change them", long, async () => {
    roles = ["support"];
    show();
    expect((await screen.findAllByAltText("Phones from ₦50,000", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getByText("Only operations admins add and change banners.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add banner" })).toBeNull();
    expect((screen.getAllByRole("switch", { name: /Show the banner/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
