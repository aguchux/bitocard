// Site › Message board: what Udozo's team tells customers on their account dashboard. Operations write a post
// (market, kind, title, message, link, pin), switch it on and off from the list and delete it; support only reads.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/message-board" }));

await import("@/app/api-product");
const { default: MessageBoardPage } = await import("@/app/(console)/message-board/page");

let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

const existing = {
  object: "board_post",
  id: "p1",
  country: "NG",
  title: "Safe pay in Lagos",
  body: "Pay through Udozo.",
  tone: "tip",
  href: "/safe-trade",
  link_label: "How it works",
  pinned: true,
  enabled: true,
  state: "showing",
  starts_at: null,
  ends_at: null,
  created_at: "2026-11-08T00:00:00.000Z",
  updated_at: "2026-11-08T00:00:00.000Z",
};

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
    if (url.pathname === "/v1/admin/classifieds/board" && input.method === "GET") return ok({ object: "list", data: [existing] });
    if (url.pathname === "/v1/admin/classifieds/board" && input.method === "POST") return ok({ ...existing, id: "p2", ...(body as object) }, 201);
    if (url.pathname === "/v1/admin/classifieds/board/p1" && input.method === "PATCH") return ok({ ...existing, ...(body as object) });
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
        <MessageBoardPage />
      </AdminGate>
    </AdminProviders>,
  );
const slow = { timeout: 15000 };
const long = { timeout: 30000 };

describe("the message board", () => {
  test("each post shows its kind, market and state; the switch turns it off", long, async () => {
    show();
    expect((await screen.findAllByText("Safe pay in Lagos", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tip · Pinned").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Nigeria").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Showing").length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("switch", { name: "Show the post “Safe pay in Lagos”" })[0]!);
    await waitFor(() => expect(sent.find(item => item.method === "PATCH")).toEqual({ method: "PATCH", path: "/v1/admin/classifieds/board/p1", body: { enabled: false } }), slow);
  });

  test("operations write one: market, kind, title, message, link and pin", long, async () => {
    show();
    fireEvent.click(await screen.findByRole("button", { name: "New post" }, slow));
    const dialog = await screen.findByRole("dialog", {}, slow);
    fireEvent.change(within(dialog).getByLabelText("Market"), { target: { value: "GH" } });
    fireEvent.change(within(dialog).getByLabelText("Kind"), { target: { value: "alert" } });
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Check your payout account" } });
    fireEvent.change(within(dialog).getByLabelText("Message"), { target: { value: "Banks change on Monday.\nCheck yours." } });
    fireEvent.change(within(dialog).getByLabelText("Link"), { target: { value: "/account/payouts" } });
    fireEvent.change(within(dialog).getByLabelText("Link words"), { target: { value: "Check it" } });
    fireEvent.click(within(dialog).getByRole("switch", { name: "Pin this post" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Post it" }));
    await waitFor(() => expect(sent.some(item => item.method === "POST" && item.path === "/v1/admin/classifieds/board")).toBe(true), slow);
    expect(sent.find(item => item.method === "POST")?.body).toEqual({ country: "GH", title: "Check your payout account", body: "Banks change on Monday.\nCheck yours.", tone: "alert", href: "/account/payouts", link_label: "Check it", pinned: true, enabled: true, starts_at: null, ends_at: null });
  });

  test("support reads the posts and cannot change them", long, async () => {
    roles = ["support"];
    show();
    expect((await screen.findAllByText("Safe pay in Lagos", {}, slow)).length).toBeGreaterThan(0);
    expect(screen.getByText("Only operations admins write and change posts.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New post" })).toBeNull();
    expect((screen.getAllByRole("switch", { name: /Show the post/ })[0] as HTMLButtonElement).disabled).toBe(true);
  });
});
