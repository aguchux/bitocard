import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { fakeApi, renderSignedIn, session } from "./helpers";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: () => undefined }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/settings/profile",
}));

await import("@/app/api-product");
const { default: ProfilePage } = await import("@/app/(console)/settings/profile/page");

const slow = { timeout: 5000 };
const unconfirmed = { ...session, user: { ...session.user, name: "Ada Obi Eze", first_name: "Ada", last_name: "Obi Eze", name_confirmed: false } };

afterEach(cleanup);

describe("first and last name in Seller HQ", () => {
  test("an older account is asked to check its split name; saving sends both apart", async () => {
    const sent = fakeApi({
      "/v1/auth/session": unconfirmed,
      "PATCH /v1/auth/profile": { ...unconfirmed, user: { ...unconfirmed.user, first_name: "Ada Obi", last_name: "Eze", name_confirmed: true } },
    });
    renderSignedIn(<ProfilePage />);
    expect(await screen.findByText("Please check your first and last name, as on your ID.", {}, slow)).toBeTruthy();
    // The form opens by itself, with the split filled in.
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("Ada");
    expect((screen.getByLabelText("Last name") as HTMLInputElement).value).toBe("Obi Eze");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Ada Obi" } });
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Eze" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm my name" }));
    await waitFor(() => expect(sent.find(item => item.method === "PATCH" && item.path === "/v1/auth/profile")?.body).toEqual({ first_name: "Ada Obi", last_name: "Eze" }), slow);
  });

  test("a confirmed name shows both parts and no reminder", async () => {
    fakeApi({ "/v1/auth/session": { ...session, user: { ...session.user, first_name: "Ada", last_name: "Obi", name_confirmed: true } } });
    renderSignedIn(<ProfilePage />);
    expect(await screen.findByText("Obi", {}, slow)).toBeTruthy();
    expect(screen.queryByText("Please check your first and last name, as on your ID.")).toBeNull();
    expect(screen.queryByLabelText("First name")).toBeNull();
  });
});
