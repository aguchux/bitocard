// Site › Watermarks: Udozo's text drawn on listing photos (with a preview), whether `photo_watermarks` and
// `store_watermarks` are on, and the stores whose resellers set their own text. Operations change the text and clear a
// store's (with a reason); support only sees them.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/watermarks" }));

await import("@/app/api-product");
const { default: WatermarksPage } = await import("@/app/(console)/watermarks/page");

let roles: string[];
let photosOn: boolean;
let current: Record<string, unknown>;
let sent: Array<{ method: string; path: string; body: unknown }>;

const settings = { object: "watermark_settings", text: "udozo.com", version: 3, updated_at: "2026-11-03T09:00:00.000Z", updated_by: { id: "a2", name: "Bola" } };
const storeRow = {
  object: "store_watermark",
  id: "s1",
  name: "Ada Resale",
  address: "adaresale.com",
  reseller: { id: "r1", name: "Ada Stores" },
  watermark_text: "adaresale.com",
  updated_at: "2026-11-02T09:00:00.000Z",
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
  photosOn = false;
  current = settings;
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/switches")
      return ok({
        object: "list",
        data: [
          { object: "switch", key: "photo_watermarks", scope: "global", country_code: null, reseller_id: null, enabled: photosOn },
          { object: "switch", key: "store_watermarks", scope: "reseller", country_code: null, reseller_id: "r1", enabled: true },
        ],
        has_more: false,
        definitions: { photo_watermarks: { scopes: ["global"], description: "", default: false }, store_watermarks: { scopes: ["global", "country", "reseller"], description: "", default: false } },
      });
    if (url.pathname === "/v1/admin/classifieds/watermark" && input.method === "GET") return ok(current);
    if (url.pathname === "/v1/admin/classifieds/watermark" && input.method === "PUT") {
      current = { ...settings, ...(body as object), version: 4, updated_at: "2026-11-04T09:00:00.000Z", updated_by: { id: "a1", name: "Ada" } };
      return ok(current);
    }
    if (url.pathname === "/v1/admin/classifieds/watermark/stores") return ok({ object: "list", data: [storeRow] });
    if (url.pathname === "/v1/admin/stores/s1/watermark" && input.method === "DELETE") return ok({ object: "store", id: "s1", watermark_text: null });
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
        <WatermarksPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };

/** Udozo's own admin routes only: never BitoCard's, Afrippa's or anything outside the admin. */
const udozoRoutes = /^\/v1\/admin\/(auth\/session|notifications\/unread-count|switches|classifieds\/watermark(\/stores)?|stores\/[^/]+\/watermark)$/;

describe("watermarks", () => {
  test("shows Udozo's text, its version and last change, a preview, the switches and stores with their own text", long, async () => {
    show();
    const field = (await screen.findByLabelText("Watermark text", {}, slow)) as HTMLInputElement;
    expect(field.value).toBe("udozo.com");
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText(/by Bola/)).toBeTruthy();
    expect(screen.getByRole("img", { name: "Preview of a listing photo marked “udozo.com”" })).toBeTruthy();
    expect(await screen.findByText("Off", {}, slow)).toBeTruthy();
    expect(screen.getByText(/Also switched on for 1 market or reseller/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings > Feature switches" }).getAttribute("href")).toBe("/settings");
    expect(await screen.findAllByText("Ada Resale", {}, slow)).toBeTruthy();
    expect(screen.getAllByText("adaresale.com").length).toBeGreaterThan(0);
    expect(sent.every(item => udozoRoutes.test(item.path)), JSON.stringify(sent.map(item => item.path))).toBe(true);
  });

  test("once photos are marked, it says to purge the Spaces CDN", long, async () => {
    photosOn = true;
    show();
    expect(await screen.findByText("Once it is on: purge the CDN", {}, slow)).toBeTruthy();
    expect(screen.getAllByText("udozo/classifieds/*").length).toBeGreaterThan(0);
  });

  test("checks the text before saving it with PUT, and the preview follows", long, async () => {
    show();
    const field = await screen.findByLabelText("Watermark text", {}, slow);
    const save = screen.getByRole("button", { name: "Save watermark" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "u" } });
    expect(screen.getByText("Use at least 2 characters.")).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(field, { target: { value: "udozo!" } });
    expect(screen.getByText("Use only letters, digits, spaces and . - _ @")).toBeTruthy();
    fireEvent.change(field, { target: { value: "x".repeat(31) } });
    expect(screen.getByText("Use at most 30 characters.")).toBeTruthy();
    fireEvent.change(field, { target: { value: " Udozo @ NG " } });
    expect(screen.getByRole("img", { name: "Preview of a listing photo marked “Udozo @ NG”" })).toBeTruthy();
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(sent.find(item => item.method === "PUT")).toEqual({ method: "PUT", path: "/v1/admin/classifieds/watermark", body: { text: "Udozo @ NG" } }), slow);
    expect(await screen.findByText("Watermark saved.", {}, slow)).toBeTruthy();
  });

  test("clears a store's text with a reason", long, async () => {
    show();
    await screen.findAllByText("Ada Resale", {}, slow);
    fireEvent.click(screen.getAllByRole("button", { name: "Clear" })[0]!);
    const dialog = await screen.findByRole("dialog", {}, slow);
    const confirm = within(dialog).getByRole("button", { name: "Clear" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText("Reason"), { target: { value: "Names another company" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(sent.find(item => item.method === "DELETE")).toEqual({ method: "DELETE", path: "/v1/admin/stores/s1/watermark", body: { reason: "Names another company" } }), slow);
  });

  test("support sees everything and changes nothing", long, async () => {
    roles = ["support"];
    show();
    expect(((await screen.findByLabelText("Watermark text", {}, slow)) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("Only operations admins change the watermark and clear stores’ text.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save watermark" })).toBeNull();
    await screen.findAllByText("Ada Resale", {}, slow);
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});
