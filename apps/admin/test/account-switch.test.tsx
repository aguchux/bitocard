// The reseller page's Customer account card and the customer page's Reseller account card: move a person who signed up
// as the wrong kind of account, with a reason, suspending the reseller only when BitoCard holds no money for it.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined, prefetch: () => undefined }), useParams: () => ({}), useSearchParams: () => new URLSearchParams(), usePathname: () => "/resellers/r1" }));

const { MakeCustomerCard, MakeResellerCard } = await import("@/components/account-switch");

const slow = { timeout: 10000 };
let posts: Array<{ path: string; body: Record<string, unknown> }>;
let holdsMoney: boolean;
let countryOpen: boolean;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
  posts = [];
  holdsMoney = false;
  countryOpen = true;
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const url = new URL(input.url);
    if (input.method === "POST") {
      posts.push({ path: url.pathname, body: await input.json() });
      return Response.json({ object: "account_switch" });
    }
    if (url.pathname === "/v1/admin/resellers/r1/make-customer") {
      return Response.json({ object: "reseller_customer_preview", owner: { name: "Ada Obi", email: "ada@example.com", email_confirmed: true, has_password: true }, existing_customer_id: null, reseller_status: "pending", holds_money: holdsMoney, published_stores: 0 });
    }
    if (url.pathname === "/v1/admin/storefront/customers/c1/make-reseller") {
      return Response.json({ object: "customer_reseller_preview", customer: { name: "Chi Okafor", email: "chi@example.com", email_confirmed: true, country: "NG" }, existing_reseller_id: null, seller_hq_person: false, country_open: countryOpen, country_name: "Nigeria" });
    }
    return Response.json({ error: { type: "not_found_error", code: "resource_missing", message: "Not found." } }, { status: 404 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Make a customer", () => {
  test("makes the owner a customer and suspends the reseller account, with a reason", async () => {
    render(
      <AdminProviders>
        <MakeCustomerCard resellerId="r1" canChange />
      </AdminProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Make a customer" }, slow));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(/Also suspend the reseller account/) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "Only meant to buy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make a customer" }));
    await waitFor(() => expect(posts).toEqual([{ path: "/v1/admin/resellers/r1/make-customer", body: { reason: "Only meant to buy", suspend_reseller: true } }]));
  });

  test("never offers to suspend a reseller BitoCard holds money for", async () => {
    holdsMoney = true;
    render(
      <AdminProviders>
        <MakeCustomerCard resellerId="r1" canChange />
      </AdminProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Make a customer" }, slow));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText(/Also suspend/)).toBeNull();
    expect(within(dialog).getByText(/BitoCard holds money for this reseller/)).toBeTruthy();
  });

  test("support sees it but cannot change it", async () => {
    render(
      <AdminProviders>
        <MakeCustomerCard resellerId="r1" canChange={false} />
      </AdminProviders>,
    );
    await screen.findByText(/gets a customer account with the same email and password/, undefined, slow);
    expect(screen.queryByRole("button", { name: "Make a customer" })).toBeNull();
  });
});

describe("Make a reseller", () => {
  test("opens a reseller account with the business name and a reason", async () => {
    render(
      <AdminProviders>
        <MakeResellerCard customerId="c1" canChange />
      </AdminProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Make a reseller" }, slow));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Business name"), { target: { value: "Chi Gifts" } });
    const reason = within(dialog).getAllByRole("textbox").find(box => box.id !== "make-reseller-business")!;
    fireEvent.change(reason, { target: { value: "Wants to sell" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Make a reseller" }));
    await waitFor(() => expect(posts).toEqual([{ path: "/v1/admin/storefront/customers/c1/make-reseller", body: { business_name: "Chi Gifts", reason: "Wants to sell" } }]));
  });

  test("is closed where reseller sign-up is not open", async () => {
    countryOpen = false;
    render(
      <AdminProviders>
        <MakeResellerCard customerId="c1" canChange />
      </AdminProviders>,
    );
    expect((await screen.findByRole("button", { name: "Make a reseller" }, slow) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Reseller sign-up is not open in Nigeria.")).toBeTruthy();
  });
});
