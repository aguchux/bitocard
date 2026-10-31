import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeApi, refusal, renderSignedIn, session } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
}));

await import("@/app/api-product");

const slow = { timeout: 5000 };
// A Google sign-up: signed in, email confirmed by Google, Google's names unconfirmed, no business yet.
const googleSignUp = { ...session, user: { ...session.user, name: "Kofi Mensah", first_name: "Kofi", last_name: "Mensah", name_confirmed: false, phone: null, phone_verified: false, has_password: false }, memberships: [] };
const countries = { object: "list", data: [{ object: "country", code: "GH", name: "Ghana", currency: "GHS", reseller_signup: true }] };
const token = { object: "signup_verification", email: "ada@example.com", signup_token: "onboard-token-0000000000", expires_at: "2099-01-01T00:00:00.000Z" };

afterEach(cleanup);

/** Fills in the first step: the name kept from Google but changed, the business, Ghana and a Ghanaian mobile. */
async function fillDetails() {
  fireEvent.change(await screen.findByLabelText("First name", {}, slow), { target: { value: "Kofi Ama" } });
  fireEvent.change(screen.getByLabelText("Business name"), { target: { value: "Kofi Digital" } });
  fireEvent.change(await screen.findByLabelText("Business country", {}, slow), { target: { value: "GH" } });
  fireEvent.change(await screen.findByLabelText("Your mobile number", {}, slow), { target: { value: "024 123 4567" } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

describe("Seller HQ's onboarding after a Google sign-up", () => {
  test("the name is checked, the mobile texted a code and confirmed, then the account opens with it as a sign-in number", async () => {
    const sent = fakeApi({
      "/v1/auth/session": googleSignUp,
      "/v1/countries": countries,
      "PATCH /v1/auth/profile": googleSignUp,
      "POST /v1/auth/onboarding/signup-token": token,
      "POST /v1/auth/signup/phone": Response.json({ object: "notice", message: "A code is on its way." }, { status: 202 }),
      "POST /v1/auth/signup/phone/verify": { object: "signup_phone_verification", phone: "+233241234567", verified_at: "2026-10-31T00:00:00.000Z" },
      "POST /v1/auth/reseller-account": googleSignUp,
    });
    renderSignedIn(<p>Console</p>);
    expect((await screen.findByLabelText("Last name", {}, slow) as HTMLInputElement).value).toBe("Mensah");
    await fillDetails();
    expect(await screen.findByText("Confirm your mobile", {}, slow)).toBeTruthy();
    expect(sent.find(item => item.method === "PATCH" && item.path === "/v1/auth/profile")?.body).toEqual({ first_name: "Kofi Ama", last_name: "Mensah" });
    expect(sent.find(item => item.path === "/v1/auth/signup/phone")?.body).toEqual({ email: googleSignUp.user.email, signup_token: token.signup_token, country: "GH", phone: "+233241234567" });

    const boxes = screen.getAllByRole("textbox").filter(box => box.getAttribute("aria-label")?.startsWith("Digit"));
    fireEvent.change(boxes[0]!, { target: { value: "123456" } });
    await waitFor(() => expect(sent.find(item => item.path === "/v1/auth/reseller-account")?.body).toEqual({ business_name: "Kofi Digital", country: "GH", phone: "+233241234567", signup_token: token.signup_token }), slow);
    expect(sent.find(item => item.path === "/v1/auth/signup/phone/verify")?.body).toEqual({ email: googleSignUp.user.email, signup_token: token.signup_token, code: "123456" });
  });

  test("where the country cannot text yet, the account opens with the number kept unconfirmed", async () => {
    const sent = fakeApi({
      "/v1/auth/session": googleSignUp,
      "/v1/countries": countries,
      "PATCH /v1/auth/profile": googleSignUp,
      "POST /v1/auth/onboarding/signup-token": token,
      "POST /v1/auth/signup/phone": refusal(400, "phone_verification_unavailable", "We cannot text numbers in this country yet.", "phone"),
      "POST /v1/auth/reseller-account": googleSignUp,
    });
    renderSignedIn(<p>Console</p>);
    await fillDetails();
    await waitFor(() => expect(sent.find(item => item.path === "/v1/auth/reseller-account")?.body).toEqual({ business_name: "Kofi Digital", country: "GH", phone: "+233241234567" }), slow);
    expect(screen.queryByText("Confirm your mobile")).toBeNull();
  });
});
