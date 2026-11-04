import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import { fakeApi, refusal } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/signup",
}));

await import("@/app/api-product");
const { SignUp } = await import("@/app/signup/sign-up");

const slow = { timeout: 10000 };
const countries = { object: "list", data: [{ object: "country", code: "GH", name: "Ghana", currency: "GHS", reseller_signup: true }] };
const created = { object: "session", user: { object: "user", id: "u1", name: "Kofi Mensah", email: "kofi@example.com", email_verified: true, phone: "+233241234567", phone_verified: true, has_password: true, created_at: "2026-10-31T00:00:00.000Z" }, memberships: [] };

function signUpRoutes() {
  return fakeApi({
    "/v1/auth/session": refusal(401, "not_signed_in", "Sign in first."),
    "/v1/countries": countries,
    "POST /v1/auth/signup/email": { object: "notice", message: "A code is on its way." },
    "POST /v1/auth/signup/email/verify": { object: "signup_verification", email: "kofi@example.com", signup_token: "signup-token-0000000000000", expires_at: "2026-10-31T01:00:00.000Z" },
    "POST /v1/auth/signup": created,
  });
}

/** The email alone and its code, then names, business and country, then the mobile number. */
async function upToBusiness() {
  render(
    <AdminProviders>
      <SignUp sellerTermsUrl="/legal/sellers" termsUrl="/legal/terms" privacyUrl="/legal/privacy" />
    </AdminProviders>,
  );
  expect(screen.getByText(/Step 1 of 5/)).toBeTruthy();
  expect(screen.queryByLabelText("First name")).toBeNull();
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "kofi@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Digit 1 of 6", {}, slow), { target: { value: "123456" } });
  fireEvent.change(await screen.findByLabelText("First name", {}, slow), { target: { value: "Kofi" } });
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Mensah" } });
  fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Kofi Digital" } });
  await waitFor(() => expect(screen.getByRole("option", { name: "Ghana (GHS)" })).toBeTruthy(), slow);
  fireEvent.change(screen.getByLabelText("Business country"), { target: { value: "GH" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.change(await screen.findByLabelText("Your mobile number", {}, slow), { target: { value: "024 123 4567" } });
}

afterEach(cleanup);

describe("Seller HQ sign-up", () => {
  test("takes the mobile as typed, texts nothing, and creates the account with it to confirm later", async () => {
    const sent = signUpRoutes();
    await upToBusiness();
    expect(screen.getByText(/Confirm it with a texted code later in Settings/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Text me a code" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Password", {}, slow), { target: { value: "correct horse battery" } });
    expect(screen.getByText(/Step 5 of 5/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/auth/signup")).toBe(true), slow);
    expect(sent.find(item => item.path === "/v1/auth/signup")?.body).toMatchObject({ first_name: "Kofi", last_name: "Mensah", email: "kofi@example.com", country: "GH", business_name: "Kofi Digital", phone: "+233241234567", signup_token: "signup-token-0000000000000" });
    expect(sent.find(item => item.path === "/v1/auth/signup")?.body).not.toHaveProperty("name");
    expect(sent.some(item => item.path.startsWith("/v1/auth/signup/phone"))).toBe(false);
  }, 20000);

  test("Back from the password returns to the mobile, kept as typed", async () => {
    signUpRoutes();
    await upToBusiness();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Password", {}, slow);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(((await screen.findByLabelText("Your mobile number", {}, slow)) as HTMLInputElement).value).toMatch(/24 123 4567/);
  }, 20000);
});
