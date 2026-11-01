import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const params = { id: "m1" };
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => params, useSearchParams: () => new URLSearchParams(), usePathname: () => "/support/contact" }));

await import("@/app/api-product");
const { default: ListPage } = await import("@/app/(console)/support/contact/page");
const { default: MessagePage } = await import("@/app/(console)/support/contact/[id]/page");
const { menus } = await import("@/components/shell");

const slow = { timeout: 10000 };
const message = (over: Record<string, unknown> = {}) => ({
  object: "contact_message",
  id: "m1",
  reference: "C-000042",
  kind: "safe_pay",
  status: "new",
  name: "Chiamaka Eze",
  email: "chiamaka@example.com",
  phone: "+234 803 112 0042",
  body: "I paid with Safe pay but the seller has not answered.",
  country: "NG",
  customer_id: null,
  assignee_id: null,
  created_at: "2026-11-01T09:00:00.000Z",
  updated_at: "2026-11-01T09:00:00.000Z",
  replied_at: null,
  resolved_at: null,
  ...over,
});
let sent: Array<{ method: string; path: string; search: string; body: unknown }>;

beforeEach(() => {
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, search: url.search, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["support"] }, step_up_until: null });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/support/contact-messages") return ok({ object: "list", data: [message()], total: 1, counts: { new: 1, open: 0, waiting: 0, resolved: 0, spam: 0 } });
    if (url.pathname === "/v1/admin/support/contact-messages/m1/replies") return ok(message({ status: "waiting", entries: [{ id: "e1", kind: "reply", author_name: "Ada Okafor", body: (body as { body: string }).body, created_at: "2026-11-01T10:00:00.000Z" }] }), 201);
    if (url.pathname === "/v1/admin/support/contact-messages/m1" && input.method === "PATCH") return ok(message({ ...(body as object), entries: [] }));
    if (url.pathname === "/v1/admin/support/contact-messages/m1") return ok(message({ entries: [{ id: "e0", kind: "note", author_name: "Tunde Bello", body: "Asked the seller.", created_at: "2026-11-01T09:30:00.000Z" }] }));
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const shown = (children: React.ReactNode) =>
  render(
    <AdminProviders>
      <AdminGate>{children}</AdminGate>
    </AdminProviders>,
  );

describe("Support > Contact us", () => {
  test("is in the Support menu", () => {
    expect(menus.support!.items.some(item => item.href === "/support/contact" && item.label === "Contact us")).toBe(true);
  });

  test("lists what is to do, with what each is about, who sent it and its status", async () => {
    shown(<ListPage />);
    const row = (await screen.findAllByText(/C-000042/, {}, slow))[0]!.closest("tr")!;
    expect(row.textContent).toContain("Safe pay");
    expect(row.textContent).toContain("chiamaka@example.com");
    expect(within(row).getByText("New")).toBeTruthy();
    expect(sent.find(item => item.path === "/v1/admin/support/contact-messages")?.search).toBe("?status=active");
    expect(screen.getByRole("tab", { name: "New (1)" })).toBeTruthy();
  });

  test("a message: the sender's words and the team's notes, a reply emailed to the sender, and resolving", async () => {
    shown(<MessagePage />);
    expect(await screen.findByText("I paid with Safe pay but the seller has not answered.", {}, slow)).toBeTruthy();
    expect(screen.getByText("Asked the seller.")).toBeTruthy();
    expect(screen.getByText(/never sees this/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "chiamaka@example.com" }).getAttribute("href")).toBe("mailto:chiamaka@example.com");
    expect(screen.getByText("Not signed in (the email is as typed)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "The seller shipped it today." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sent.find(item => item.path.endsWith("/replies"))?.body).toEqual({ body: "The seller shipped it today." }), slow);

    fireEvent.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() => expect(sent.find(item => item.method === "PATCH")?.body).toEqual({ assignee_id: "a1" }), slow);
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(sent.filter(item => item.method === "PATCH").at(-1)?.body).toEqual({ status: "resolved" }), slow);
  });
});
