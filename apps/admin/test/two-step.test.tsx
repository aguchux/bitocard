// 2-step verification is each BitoCard admin's choice: Not now at the first sign-in signs them in with email and
// password, the account menu says it is off, and Your account turns it on with recovery codes shown once.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminGate, AdminProviders, AdminShell } from "@bitocard/admin-ui/shell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/account" }));

const { SignIn } = await import("@/app/signin/sign-in");
const { default: AccountPage } = await import("@/app/(console)/account/page");

const slow = { timeout: 10000 };
let sent: Array<{ method: string; path: string; body: unknown }>;
let signedIn: boolean;
let optional: boolean;
let authenticator: boolean;

beforeEach(() => {
  sent = [];
  signedIn = false;
  optional = true;
  authenticator = false;
  replace.mockReset();
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    const body = input.method === "GET" ? null : await input.json().catch(() => null);
    sent.push({ method: input.method, path: url.pathname, body });
    const ok = (value: unknown) => Response.json(value);
    const admin = { object: "admin", id: "a2", name: "Ngozi Eze", email: "ngozi@bitocard.com", roles: ["super_admin"], authenticator, authenticator_required: !optional };
    if (url.pathname === "/v1/admin/auth/session") {
      return signedIn ? ok({ object: "admin_session", admin, step_up_until: null }) : Response.json({ error: { type: "authentication_error", code: "not_signed_in", message: "Sign in." } }, { status: 401 });
    }
    if (url.pathname === "/v1/admin/auth/start") return ok({ object: "admin_sign_in", next: "password" });
    if (url.pathname === "/v1/admin/auth/signin") return ok({ object: "mfa_challenge", challenge_token: "c".repeat(48), mfa_setup_required: true, mfa_optional: optional, expires_in: 300 });
    if (url.pathname.endsWith("/mfa/setup") || url.pathname.endsWith("/authenticator/setup")) return ok({ object: "mfa_setup", secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/BitoCard%20Admin:ngozi@bitocard.com?secret=JBSWY3DPEHPK3PXP" });
    if (url.pathname === "/v1/admin/auth/mfa/skip") {
      signedIn = true;
      return ok({ object: "admin_session", admin });
    }
    if (url.pathname === "/v1/admin/auth/authenticator/confirm") {
      authenticator = true;
      return ok({ object: "admin_authenticator", authenticator: true, recovery_codes: ["abcd-1234", "efgh-5678"] });
    }
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
    if (url.pathname === "/v1/admin/notifications") return ok({ object: "list", data: [], has_more: false });
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function toAuthenticatorStep() {
  render(
    <AdminProviders>
      <SignIn />
    </AdminProviders>,
  );
  fireEvent.change(await screen.findByLabelText("Email address", {}, slow), { target: { value: "ngozi@bitocard.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Password", {}, slow), { target: { value: "a long admin passphrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Set up 2-step verification", {}, slow);
}

describe("2-step verification for BitoCard admins", () => {
  test("an admin can choose Not now at their first sign-in, and is signed in with email and password", async () => {
    await toAuthenticatorStep();
    expect(screen.getByText(/Or choose Not now to sign in with your email and password/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), slow);
    expect(sent.some(item => item.path === "/v1/admin/auth/mfa/skip")).toBe(true);
  });

  test("an admin who must use it is not offered Not now", async () => {
    optional = false;
    await toAuthenticatorStep();
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  });

  test("the account menu says it is off and links to Your account", async () => {
    signedIn = true;
    render(
      <AdminProviders>
        <AdminGate>
          <AdminShell section="home" current="/" crumbs={[{ label: "Dashboard" }]}>
            <p>Dashboard</p>
          </AdminShell>
        </AdminGate>
      </AdminProviders>,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: /Ngozi Eze/ }, slow))[0]!);
    const link = await screen.findByRole("link", { name: /Your account/ }, slow);
    expect(link.getAttribute("href")).toBe("/account");
    expect(link.textContent).toContain("2-step off");
  });

  test("they turn it on from Your account and see their recovery codes once", async () => {
    signedIn = true;
    render(
      <AdminProviders>
        <AdminGate>
          <AccountPage />
        </AdminGate>
      </AdminProviders>,
    );
    expect(await screen.findByText("Off", {}, slow)).toBeTruthy();
    expect(screen.getByText(/you sign in with your email and password/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on 2-step verification" }));
    expect(await screen.findByText(/JBSWY3DPEHPK3PXP/, {}, slow)).toBeTruthy();
    // The code's own six boxes (the page has other fields).
    const boxes = within(await screen.findByRole("group", { name: "Code from your authenticator app" }, slow)).getAllByRole("textbox") as HTMLInputElement[];
    for (const [index, digit] of [..."246810"].entries()) fireEvent.change(boxes[index]!, { target: { value: digit } });
    // Pressed only once the six digits are in (under load the button can still be off a moment).
    const turnOn = screen.getByRole("button", { name: "Turn on" }) as HTMLButtonElement;
    await waitFor(() => expect(turnOn.disabled).toBe(false), slow);
    fireEvent.click(turnOn);
    expect(await screen.findByText("abcd-1234", {}, slow)).toBeTruthy();
    expect(sent.find(item => item.path === "/v1/admin/auth/authenticator/confirm")?.body).toEqual({ code: "246810" });
    expect(await screen.findByText("On", {}, slow)).toBeTruthy();
  });
});
