// The reseller page's identity check notice: no waiver, only a test account goes live without the check, marked with a
// reason (and activated at once if asked), and unmarked again.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import type { ResellerDetail } from "@bitocard/api-client/admin";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/resellers/r1" }));

const { TestAccount } = await import("@/components/test-account");

const slow = { timeout: 10000 };
let posts: Array<{ path: string; body: Record<string, unknown> }>;

const reseller = (overrides: Partial<ResellerDetail> = {}) =>
  ({ object: "reseller", id: "r1", name: "Ada Digital", country: "NG", status: "pending", verified_at: null, verified_name: null, test_account: null, members: [], stores: [], options: {}, features: {}, created_at: "2026-11-01T10:00:00.000Z", ...overrides }) as unknown as ResellerDetail;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  posts = [];
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    if (input.method === "POST") posts.push({ path: url.pathname, body: await input.json() });
    return new Response(JSON.stringify(reseller({ status: "active" })), { status: 200, headers: { "content-type": "application/json" } });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (detail: ResellerDetail, operator = true) =>
  render(
    <AdminProviders>
      <TestAccount reseller={detail} operator={operator} latestCheck="in_review" />
    </AdminProviders>,
  );

describe("the identity check on a reseller's page", () => {
  test("an unverified reseller cannot be waived through: only marked as a test account, with a reason, activated at once", slow, async () => {
    show(reseller());
    expect(screen.getByText("Identity not verified")).toBeTruthy();
    expect(screen.getByText(/The sandbox needs no check/)).toBeTruthy();
    expect(screen.queryByText(/Don.t ask for ID/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark as test account" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/never withdraws money/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Our own QA account" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark as test account" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: "/v1/admin/resellers/r1/test-account", body: { reason: "Our own QA account", activate: true } });
  });

  test("a test account says so and who marked it; operations can unmark it; support cannot act", slow, async () => {
    const marked = reseller({ status: "active", test_account: { marked_at: "2026-11-20T09:00:00.000Z", marked_by: { id: "a1", name: "Chi Okafor" }, reason: "Partner sandbox" } });
    const { unmount } = show(marked, false);
    expect(screen.getByText("Test account")).toBeTruthy();
    expect(screen.getByText(/Chi Okafor marked this a test account/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Not a test account" })).toBeNull();
    unmount();

    show(marked);
    fireEvent.click(screen.getByRole("button", { name: "Not a test account" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/go back to pending/)).toBeTruthy();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Testing finished" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Not a test account" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ path: "/v1/admin/resellers/r1/test-account/remove", body: { reason: "Testing finished" } });
  });

  test("a verified reseller shows nothing", () => {
    const { container } = show(reseller({ status: "active", verified_at: "2026-11-02T10:00:00.000Z" }));
    expect(container.textContent).toBe("");
  });
});
