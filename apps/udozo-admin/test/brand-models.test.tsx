// Marketplace > Brand registry > a brand's models: searched and filtered by category and source a page at a time, a model
// renamed or turned off, many added at once with those already there left to look at; and models sellers typed, added or
// dismissed from the registry's page. Support looks, never changes.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({ slug: "toyota" }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/brands/toyota" }));

await import("@/app/api-product");
const { default: ModelsPage } = await import("@/app/(console)/classifieds/brands/[slug]/page");
const { default: BrandsPage } = await import("@/app/(console)/classifieds/brands/page");
const { readModelLines } = await import("@/components/model-lines");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const cars = { id: "c-cars", slug: "cars", name: "Cars" };
const model = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ object: "classified_brand_model", id, name, aliases: [], category: cars, position: 0, source: "registry", enabled: true, listings: 0, updated_at: "2026-11-02T10:00:00.000Z", ...extra });
const corolla = model("m-1", "Corolla", { aliases: ["altis"], listings: 12 });
const learned = model("m-2", "Hilux Vigo Champ", { source: "sellers", position: 90 });
const suggestion = { object: "classified_model_suggestion_group", brand: { id: "b-toyota", slug: "toyota", name: "Toyota" }, category: cars, name_key: "zenithrover", name: "Zenith Rover", sellers: 2, last_at: "2026-11-02T10:00:00.000Z" };

beforeEach(() => {
  roles = ["operations"];
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: `${url.pathname}${url.search}`, body });
    const path = url.pathname;
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (path === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (path === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (path === "/v1/admin/media/settings") return ok({ object: "media_settings", configured: false, purposes: [] });
    if (path === "/v1/admin/classifieds/categories") return ok({ object: "list", country: "NG", data: [] });
    if (path === "/v1/admin/classifieds/brands") return ok({ object: "list", data: [], total: 0, offset: 0, limit: 50 });
    if (path === "/v1/admin/classifieds/brand-suggestions") return ok({ object: "list", data: [] });
    if (path === "/v1/admin/classifieds/model-suggestions") return ok({ object: "list", data: [suggestion], learn_from: 3 });
    if (path === "/v1/admin/classifieds/model-suggestions/dismiss") return ok({ object: "classified_model_suggestion_group", name_key: "zenithrover", dismissed: 2 });
    if (path === "/v1/admin/classifieds/brands/toyota/models/import") return ok({ object: "classified_model_import", added: 2, skipped: [{ name: "Corolla", reason: "Corolla is already in the list." }], listings_renamed: 1 });
    if (path === "/v1/admin/classifieds/brands/toyota/models" && input.method === "POST") return ok({ ...model("m-9", "Zenith Rover", { source: "admin" }), listings_renamed: 2, suggestions_answered: 2 }, 201);
    if (path === "/v1/admin/classifieds/brands/toyota/models") return ok({ object: "list", data: url.searchParams.get("source") === "sellers" ? [learned] : [corolla, learned], total: 120, offset: Number(url.searchParams.get("offset") ?? 0), limit: 50, brand: { slug: "toyota", name: "Toyota" }, categories: [{ ...cars, models: 120 }, { id: "c-buses", slug: "buses", name: "Buses", models: 8 }] });
    if (path === "/v1/admin/classifieds/models/m-1") return ok({ ...corolla, ...(body as object), listings_renamed: 3, suggestions_answered: 0 });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (Page: () => React.ReactElement) =>
  render(
    <AdminProviders>
      <AdminGate>
        <Page />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const lastBody = (method: string, path: string) => [...sent].reverse().find(item => item.method === method && item.path === path)?.body;

describe("a brand's models", () => {
  test("the list with its search words and where each came from, a page at a time, filtered", slow, async () => {
    show(ModelsPage);
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Corolla")).toBeTruthy();
    expect(within(table).getByText("altis")).toBeTruthy();
    expect(within(table).getByText("From sellers")).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Toyota models" })).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "sellers" } });
    await waitFor(() => expect(sent.some(item => item.path.includes("source=sellers"))).toBe(true));
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), { target: { value: "" } });
    fireEvent.click(await screen.findByRole("button", { name: "Next" }));
    await waitFor(() => expect(sent.some(item => item.path.includes("offset=50"))).toBe(true));
  });

  test("renaming a model says the ads followed; turning it off", slow, async () => {
    show(ModelsPage);
    fireEvent.click((await screen.findAllByRole("button", { name: /Corolla/ }))[0]!);
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "Corolla Altis" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/3 ads now read/)).toBeTruthy();
    expect(lastBody("PATCH", "/v1/admin/classifieds/models/m-1")).toEqual({ name: "Corolla Altis", aliases: ["altis"] });
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(lastBody("PATCH", "/v1/admin/classifieds/models/m-1")).toEqual({ enabled: false }));
  });

  test("many at once: lines read with their search words, and those already there are left to look at", slow, async () => {
    expect(readModelLines("Galaxy S24 | s24, s24 5g\n\n  Corolla  \n| nothing")).toEqual([{ name: "Galaxy S24", aliases: ["s24", "s24 5g"] }, { name: "Corolla", aliases: [] }]);
    show(ModelsPage);
    await screen.findAllByRole("button", { name: /Corolla/ });
    const box = await screen.findByLabelText("Models");
    fireEvent.change(box, { target: { value: "Crown | crown royal\nCorolla" } });
    fireEvent.click(screen.getByRole("button", { name: "Add 2 models" }));
    expect(await screen.findByText(/Added 2\./)).toBeTruthy();
    expect(lastBody("POST", "/v1/admin/classifieds/brands/toyota/models/import")).toEqual({ category_id: "c-cars", models: [{ name: "Crown", aliases: ["crown royal"] }, { name: "Corolla", aliases: [] }] });
    await waitFor(() => expect((box as HTMLTextAreaElement).value).toBe("Corolla"));
  });

  test("support looks and never changes", slow, async () => {
    roles = ["support"];
    show(ModelsPage);
    fireEvent.click((await screen.findAllByRole("button", { name: /Corolla/ }))[0]!);
    expect((await screen.findByLabelText("Name")).closest("fieldset")?.disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText("Models")).toBeNull();
  });
});

describe("models sellers typed", () => {
  test("listed with how many sellers, then added or dismissed", slow, async () => {
    show(BrandsPage);
    expect(await screen.findByText("New models from sellers (1)")).toBeTruthy();
    expect(screen.getByText(/once 3 different sellers/)).toBeTruthy();
    const row = (await screen.findByText("Toyota Zenith Rover")).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Add" }));
    await waitFor(() => expect(lastBody("POST", "/v1/admin/classifieds/brands/toyota/models")).toEqual({ name: "Zenith Rover", category_id: "c-cars" }));
    fireEvent.click(within(row).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(lastBody("POST", "/v1/admin/classifieds/model-suggestions/dismiss")).toEqual({ brand_id: "b-toyota", category_id: "c-cars", name_key: "zenithrover" }));
  });

  test("support sees them and cannot act", slow, async () => {
    roles = ["support"];
    show(BrandsPage);
    const row = (await screen.findByText("Toyota Zenith Rover")).closest("li")!;
    expect(within(row).queryByRole("button", { name: "Add" })).toBeNull();
  });
});
