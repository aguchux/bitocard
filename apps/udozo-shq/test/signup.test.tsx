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

function signUpRoutes(phone: unknown) {
  return fakeApi({
    "/v1/auth/session": refusal(401, "not_signed_in", "Sign in first."),
    "/v1/countries": countries,
    "POST /v1/auth/signup/email": { object: "notice", message: "A code is on its way." },
    "POST /v1/auth/signup/email/verify": { object: "signup_verification", email: "kofi@example.com", signup_token: "signup-token-0000000000000", expires_at: "2026-10-31T01:00:00.000Z" },
    "POST /v1/auth/signup/phone": phone,
    "POST /v1/auth/signup/phone/verify": { object: "signup_phone_verification", phone: "+233241234567", verified_at: "2026-10-31T00:10:00.000Z" },
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
  expect(screen.getByText(/Step 1 of 6/)).toBeTruthy();
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
  fireEvent.click(screen.getByRole("button", { name: "Text me a code" }));
}

afterEach(cleanup);

describe("Seller HQ sign-up", () => {
  test("texts the mobile a code, confirms it, then creates the account with it", async () => {
    const sent = signUpRoutes({ object: "notice", message: "A code is on its way to +233241234567." });
    await upToBusiness();
    expect(await screen.findByText(/Enter the 6-digit code we texted to/, {}, slow)).toBeTruthy();
    expect(sent.find(item => item.path === "/v1/auth/signup/phone")?.body).toEqual({ email: "kofi@example.com", signup_token: "signup-token-0000000000000", country: "GH", phone: "+233241234567" });

    fireEvent.change(screen.getByLabelText("Digit 1 of 6"), { target: { value: "654321" } });
    fireEvent.change(await screen.findByLabelText("Password", {}, slow), { target: { value: "correct horse battery" } });
    expect(sent.find(item => item.path === "/v1/auth/signup/phone/verify")?.body).toEqual({ email: "kofi@example.com", signup_token: "signup-token-0000000000000", code: "654321" });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/auth/signup")).toBe(true), slow);
    expect(sent.find(item => item.path === "/v1/auth/signup")?.body).toMatchObject({ name: "Kofi Mensah", email: "kofi@example.com", country: "GH", business_name: "Kofi Digital", phone: "+233241234567", signup_token: "signup-token-0000000000000" });
  }, 20000);

  test("where the country cannot text, it says so and carries on with the number unconfirmed", async () => {
    const sent = signUpRoutes(refusal(409, "phone_verification_unavailable", "Phone verification is not available in your country yet."));
    await upToBusiness();
    expect(await screen.findByText(/We cannot text numbers in your country yet/, {}, slow)).toBeTruthy();
    expect(screen.queryByText(/Confirm your mobile/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse battery" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(sent.some(item => item.path === "/v1/auth/signup")).toBe(true), slow);
    expect(sent.find(item => item.path === "/v1/auth/signup")?.body).toMatchObject({ phone: "+233241234567" });
    expect(sent.some(item => item.path === "/v1/auth/signup/phone/verify")).toBe(false);
  }, 20000);
});
