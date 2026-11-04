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
  test("one step: the name is checked, then the account opens with the business, country and the mobile as typed, nothing texted", async () => {
    const sent = fakeApi({
      "/v1/auth/session": googleSignUp,
      "/v1/countries": countries,
      "PATCH /v1/auth/profile": googleSignUp,
      "POST /v1/auth/reseller-account": googleSignUp,
    });
    renderSignedIn(<p>Console</p>);
    expect((await screen.findByLabelText("Last name", {}, slow) as HTMLInputElement).value).toBe("Mensah");
    await fillDetails();
    await waitFor(() => expect(sent.find(item => item.path === "/v1/auth/reseller-account")?.body).toEqual({ business_name: "Kofi Digital", country: "GH", phone: "+233241234567" }), slow);
    expect(sent.find(item => item.method === "PATCH" && item.path === "/v1/auth/profile")?.body).toEqual({ first_name: "Kofi Ama", last_name: "Mensah" });
    expect(sent.some(item => item.path.startsWith("/v1/auth/signup/phone") || item.path === "/v1/auth/onboarding/signup-token")).toBe(false);
    expect(screen.queryByText("Confirm your mobile")).toBeNull();
  });

  test("a refusal keeps the person on the form, saying why", async () => {
    fakeApi({
      "/v1/auth/session": googleSignUp,
      "/v1/countries": countries,
      "PATCH /v1/auth/profile": googleSignUp,
      "POST /v1/auth/reseller-account": refusal(409, "phone_in_use", "Another account already uses this number.", "phone"),
    });
    renderSignedIn(<p>Console</p>);
    await fillDetails();
    expect(await screen.findByText("Another account already uses this number.", {}, slow)).toBeTruthy();
    expect(screen.getByLabelText("Business name")).toBeTruthy();
  });
});
