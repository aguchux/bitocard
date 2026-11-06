// Marketplace > Categories: each subcategory's search words (what people call the things sold there, matched on Post
// an ad, in search suggestions and by the assistants), counted on its row; operations edit them one a line, cleaned
// before saving; support only sees the count.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/classifieds/categories" }));

await import("@/app/api-product");
const { default: CategoriesPage } = await import("@/app/(console)/classifieds/categories/page");
const { textWords, wordsText } = await import("@/components/category-words");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const category = (id: string, slug: string, name: string, sku_prefix: string, keywords: string[]) => ({ object: "classified_admin_category", id, slug, name, icon: "sofa", b2b: false, enabled: true, sku_prefix, keywords, open: true, active_listings: 3 });
const tree = () => ({
  object: "list",
  country: "NG",
  data: [{ ...category("c-home", "home-garden", "Home and living", "HOM", []), children: [category("c-rugs", "carpets-rugs", "Carpets, rugs and curtains", "CRP", ["carpet", "rug", "curtain"]), category("c-new", "garden", "Garden and outdoor", "GDN", [])] }],
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
    if (url.pathname === "/v1/admin/countries") return ok({ object: "list", data: [{ code: "NG", name: "Nigeria" }] });
    if (url.pathname === "/v1/admin/classifieds/categories") return ok(tree());
    if (url.pathname === "/v1/admin/classifieds/categories/c-rugs" && input.method === "PATCH") {
      return ok({ object: "classified_admin_category", id: "c-rugs", slug: "carpets-rugs", enabled: true, sku_prefix: "CRP", keywords: (body as { keywords: string[] }).keywords });
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

describe("search words", () => {
  test("typed text becomes clean words: one a line or by commas, lower case, each once", () => {
    expect(textWords("  Carpet \nRUG, rug\n\nshaggy   rug, x")).toEqual(["carpet", "rug", "shaggy rug"]);
    expect(wordsText(["carpet", "rug"])).toBe("carpet\nrug");
  });

  test("each subcategory shows how many it has (none marked); operations edit them one a line", slow, async () => {
    show();
    const rugs = await screen.findByRole("button", { name: "Carpets, rugs and curtains: 3 search words, change them" }, slow);
    expect(screen.getByRole("button", { name: "Garden and outdoor: No search words, change them" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Home and living: .*search words/ })).toBeNull();
    fireEvent.click(rugs);
    const box = screen.getByLabelText("Carpets, rugs and curtains: search words, one a line") as HTMLTextAreaElement;
    expect(box.value).toBe("carpet\nrug\ncurtain");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "Carpet\nrug\ncurtain\nDoor Mat, door mat" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Carpets, rugs and curtains: search words, one a line")).toBeNull(), slow);
    expect(sent.filter(item => item.method === "PATCH").map(item => item.body)).toEqual([{ keywords: ["carpet", "rug", "curtain", "door mat"] }]);
  });

  test("more than 60 words cannot be saved", slow, async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: /Carpets, rugs and curtains: 3 search words/ }, slow));
    fireEvent.change(screen.getByLabelText("Carpets, rugs and curtains: search words, one a line"), { target: { value: Array.from({ length: 61 }, (_, i) => `word ${i}`).join("\n") } });
    expect(screen.getByText("At most 60 words (61 now).")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  test("support sees the count and cannot change them", slow, async () => {
    roles = ["support"];
    show();
    expect(await screen.findByText("3 search words", {}, slow)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /search words, change them/ })).toBeNull();
  });
});
