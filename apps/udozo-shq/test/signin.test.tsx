import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import { fakeApi, refusal, session } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/signin",
}));

await import("@/app/api-product");
const { SignIn } = await import("@/app/signin/sign-in");

const slow = { timeout: 10000 };

function signIn(lookup: { exists: boolean; password: boolean }) {
  const sent = fakeApi({
    "/v1/auth/session": refusal(401, "not_signed_in", "Sign in first."),
    "POST /v1/auth/signin/lookup": { object: "account_lookup", ...lookup },
    "POST /v1/auth/signin": session,
  });
  render(
    <AdminProviders>
      <SignIn />
    </AdminProviders>,
  );
  expect(screen.queryByLabelText("Password")).toBeNull();
  fireEvent.change(screen.getByLabelText("Email or mobile number"), { target: { value: " ada@example.com " } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  return sent;
}

afterEach(cleanup);

describe("Seller HQ sign-in, the email first", () => {
  test("an account with a password: then the password, and it signs in", async () => {
    const sent = signIn({ exists: true, password: true });
    fireEvent.change(await screen.findByLabelText("Password", {}, slow), { target: { value: "correct horse battery" } });
    expect(sent.find(item => item.path === "/v1/auth/signin/lookup")?.body).toEqual({ identifier: "ada@example.com" });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(sent.find(item => item.path === "/v1/auth/signin")?.body).toEqual({ identifier: "ada@example.com", password: "correct horse battery" }), slow);
  }, 20000);

  test("no account: an offer to sign up with that email, and no password asked", async () => {
    signIn({ exists: false, password: false });
    const create = await screen.findByRole("link", { name: "Create a reseller account with it" }, slow);
    expect(create.getAttribute("href")).toBe("/signup?email=ada%40example.com");
    expect(screen.queryByLabelText("Password")).toBeNull();
  }, 20000);

  test("a Google-only account is told to use Google (or set a password)", async () => {
    signIn({ exists: true, password: false });
    expect(await screen.findByText(/This account signs in with Google/, {}, slow)).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  }, 20000);
});
