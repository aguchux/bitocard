import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminGate, AdminProviders } from "@bitocard/admin-ui/shell";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/account" }));

await import("@/app/api-product");
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
    const admin = { object: "admin", id: "a2", name: "Ngozi Eze", email: "ngozi@udozo.com", roles: ["support"], authenticator, authenticator_required: !optional };
    if (url.pathname === "/v1/admin/auth/session") {
      return signedIn ? ok({ object: "admin_session", admin, step_up_until: null }) : Response.json({ error: { type: "authentication_error", code: "not_signed_in", message: "Sign in." } }, { status: 401 });
    }
    if (url.pathname === "/v1/admin/auth/start") return ok({ object: "admin_sign_in", next: "password" });
    if (url.pathname === "/v1/admin/auth/signin") return ok({ object: "mfa_challenge", challenge_token: "c".repeat(48), mfa_setup_required: true, mfa_optional: optional, expires_in: 300 });
    if (url.pathname.endsWith("/mfa/setup") || url.pathname.endsWith("/authenticator/setup")) return ok({ object: "mfa_setup", secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/Udozo%20Admin:ngozi@udozo.com?secret=JBSWY3DPEHPK3PXP" });
    if (url.pathname === "/v1/admin/auth/mfa/skip") {
      signedIn = true;
      return ok({ object: "admin_session", admin });
    }
    if (url.pathname === "/v1/admin/auth/authenticator/confirm") {
      authenticator = true;
      return ok({ object: "admin_authenticator", authenticator: true, recovery_codes: ["abcd-1234", "efgh-5678"] });
    }
    if (url.pathname === "/v1/admin/notifications/unread-count") return ok({ object: "unread_count", count: 0 });
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
  fireEvent.change(await screen.findByLabelText("Email address", {}, slow), { target: { value: "ngozi@udozo.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Password", {}, slow), { target: { value: "a long staff passphrase" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByText("Set up 2-step verification", {}, slow);
}

describe("2-step verification for team members", () => {
  test("a team member can choose Not now at their first sign-in, and is signed in without it", async () => {
    await toAuthenticatorStep();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"), slow);
    expect(sent.some(item => item.path === "/v1/admin/auth/mfa/skip")).toBe(true);
  });

  test("super admins are not offered Not now", async () => {
    optional = false;
    await toAuthenticatorStep();
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
  });

  test("they turn it on later from Your account and see their recovery codes once", async () => {
    signedIn = true;
    render(
      <AdminProviders>
        <AdminGate>
          <AccountPage />
        </AdminGate>
      </AdminProviders>,
    );
    expect(await screen.findByText("Off", {}, slow)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on 2-step verification" }));
    expect(await screen.findByText(/JBSWY3DPEHPK3PXP/, {}, slow)).toBeTruthy();
    const boxes = (await screen.findAllByRole("textbox")) as HTMLInputElement[];
    for (const [index, digit] of [..."246810"].entries()) fireEvent.change(boxes[index]!, { target: { value: digit } });
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("abcd-1234", {}, slow)).toBeTruthy();
    expect(sent.find(item => item.path === "/v1/admin/auth/authenticator/confirm")?.body).toEqual({ code: "246810" });
    expect(await screen.findByText("On", {}, slow)).toBeTruthy();
  });
});
