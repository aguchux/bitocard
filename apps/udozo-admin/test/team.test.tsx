import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/settings/team" }));

await import("@/app/api-product");
const { default: TeamPage } = await import("@/app/(console)/settings/team/page");
const { menus } = await import("@/components/shell");

const slow = { timeout: 10000 };
const member = (over: Record<string, unknown>) => ({
  object: "admin_member",
  roles: ["support"],
  status: "active",
  password_set: true,
  authenticator: true,
  last_sign_in_at: null,
  created_at: "2026-10-30T00:00:00.000Z",
  ...over,
});
const team = {
  object: "list",
  roles: ["super_admin", "operations", "finance", "support"],
  domains: ["udozo.com"],
  data: [
    member({ id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles: ["super_admin"] }),
    member({ id: "a2", name: "Ngozi Eze", email: "ngozi@udozo.com", password_set: false, authenticator: false }),
    member({ id: "a3", name: "Tunde Bello", email: "tunde@udozo.com", roles: ["finance"], status: "disabled" }),
  ],
};
let roles: string[];
let sent: Array<{ method: string; path: string; body: unknown }>;

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

beforeEach(() => {
  roles = ["super_admin"];
  sent = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown, status = 200) => Response.json(value, { status });
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin: { id: "a1", name: "Ada Okafor", email: "ada@udozo.com", roles }, step_up_until: "2099-01-01T00:00:00.000Z" });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/team" && input.method === "POST") return ok({ ...member({ id: "a4", ...(body as object), password_set: false, authenticator: false }), email_sent: "sent" }, 201);
    if (url.pathname === "/v1/admin/team") return ok(team);
    if (url.pathname === "/v1/admin/team/a2/password-link") return ok({ ...team.data[1], email_sent: "outbox" });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = () =>
  render(
    <AdminProviders>
      <AdminGate>
        <TeamPage />
      </AdminGate>
    </AdminProviders>,
  );

describe("Settings > Team", () => {
  test("is in the Settings menu", () => {
    expect(menus.settings!.items.some(item => item.href === "/settings/team" && item.label === "Team")).toBe(true);
  });

  test("lists everyone with their roles and whether they are active, invited or suspended; never yourself to suspend", async () => {
    page();
    const table = await screen.findByRole("table", {}, slow);
    const rows = within(table).getAllByRole("row");
    const row = (name: string) => rows.find(item => item.textContent?.includes(name))!;
    expect(within(row("Ngozi Eze")).getByText("Invited")).toBeTruthy();
    expect(within(row("Ngozi Eze")).getByRole("button", { name: "Resend invitation" })).toBeTruthy();
    expect(within(row("Tunde Bello")).getByText("Suspended")).toBeTruthy();
    expect(within(row("Tunde Bello")).getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(within(row("Ada Okafor")).getByText("(you)")).toBeTruthy();
    expect(within(row("Ada Okafor")).queryByRole("button", { name: "Suspend" })).toBeNull();
  });

  test("invites staff with the roles chosen, and says the link was emailed", async () => {
    page();
    fireEvent.click(await screen.findByRole("button", { name: "Invite to the team" }, slow));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Kemi Ade" } });
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "kemi@udozo.com" } });
    fireEvent.click(screen.getByLabelText(/^Finance/));
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(sent.find(item => item.method === "POST" && item.path === "/v1/admin/team")?.body).toEqual({ name: "Kemi Ade", email: "kemi@udozo.com", roles: ["support", "finance"] }), slow);
    expect(await screen.findByText(/We emailed kemi@udozo.com a link to set their password/, {}, slow)).toBeTruthy();
  });

  test("a new link says when no email provider is set up", async () => {
    page();
    fireEvent.click((await screen.findAllByRole("button", { name: "Resend invitation" }, slow))[0]!);
    expect(await screen.findByText(/No email provider is set up/, {}, slow)).toBeTruthy();
  });

  test("other admins are told only super admins manage the team, and nothing is asked of the API", async () => {
    roles = ["operations"];
    page();
    expect(await screen.findByText("Only super admins manage the team.", {}, slow)).toBeTruthy();
    expect(sent.some(item => item.path === "/v1/admin/team")).toBe(false);
  });
});
