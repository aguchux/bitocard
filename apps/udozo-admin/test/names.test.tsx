import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/account" }));

await import("@/app/api-product");
const { default: AccountPage } = await import("@/app/(console)/account/page");
const { SetPassword } = await import("@/app/set-password/set-password");

const slow = { timeout: 10000 };
let admin: Record<string, unknown>;
let link: Record<string, unknown>;
let sent: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  sent = [];
  admin = { object: "admin", id: "a1", name: "Ada Obi Eze", first_name: "Ada", last_name: "Obi Eze", name_confirmed: false, email: "ada@udozo.com", roles: ["support"], authenticator: true, authenticator_required: false };
  link = { object: "admin_password_link", email: "kemi@udozo.com", name: "Kemi Ade", first_name: "Kemi", last_name: "Ade", name_confirmed: false, kind: "create", authenticator_set_up: false, expires_at: "2099-01-01T00:00:00.000Z" };
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown) => Response.json(value);
    if (url.pathname === "/v1/admin/auth/session") return ok({ object: "admin_session", admin, step_up_until: null });
    if (url.pathname === "/v1/admin/auth/profile") {
      admin = { ...admin, ...(body as object), name_confirmed: true };
      return ok({ object: "admin_session", admin });
    }
    if (url.pathname === "/v1/admin/auth/password-link") return ok(link);
    if (url.pathname === "/v1/admin/auth/password-link/complete") return ok({ object: "admin_password_set", email: "kemi@udozo.com", authenticator_reset: false });
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("first and last name in Udozo's admin", () => {
  test("an admin whose name was split is asked to check it, and Your account saves both apart", async () => {
    render(
      <AdminProviders>
        <AdminGate>
          <AccountPage />
        </AdminGate>
      </AdminProviders>,
    );
    expect(await screen.findByText("Please check your first and last name, as on your ID.", {}, slow)).toBeTruthy();
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Obi Eze");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada Obi" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Eze" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm my name" }));
    await waitFor(() => expect(sent.find(item => item.method === "PATCH" && item.path === "/v1/admin/auth/profile")?.body).toEqual({ first_name: "Ada Obi", last_name: "Eze" }), slow);
    expect(await screen.findByText("Saved.", {}, slow)).toBeTruthy();
  });

  test("a new admin sets their first and last name with their password", async () => {
    window.history.replaceState(null, "", "/set-password#token=tok_abc");
    render(
      <AdminProviders>
        <SetPassword />
      </AdminProviders>,
    );
    const first = (await screen.findByLabelText("First name", {}, slow)) as HTMLInputElement;
    expect(first.value).toBe("Kemi");
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Ade-Bello" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "a long staff passphrase" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "a long staff passphrase" } });
    fireEvent.submit(first.closest("form")!);
    await waitFor(() => expect(sent.find(item => item.path === "/v1/admin/auth/password-link/complete")?.body).toMatchObject({ token: "tok_abc", first_name: "Kemi", last_name: "Ade-Bello" }), slow);
  });
});
