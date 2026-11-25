import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminProviders } from "@bitocard/admin-ui/shell";
import ReservedAccountsPage from "@/app/(console)/wallet/reserved-accounts/page";
import TopUpsPage from "@/app/(console)/wallet/top-ups/page";

let currency: string | null;
let hasAccount: boolean;
let submitted: unknown;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(currency ? { currency } : {}),
}));
vi.mock("@/components/shq-shell", () => ({ ShqShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/reseller", () => ({
  useReseller: () => ({ membership: { role: "owner", reseller: { country: "NG", status: "active" } }, mode: "test" }),
  can: () => true,
}));

beforeEach(() => {
  currency = null;
  hasAccount = false;
  submitted = undefined;
  vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
  vi.stubGlobal("fetch", vi.fn(async (request: Request) => {
    switch (new URL(request.url).pathname) {
      case "/v1/wallet":
        return Response.json({ wallets: [{ currency: "NGN", primary: true, available: 0 }, { currency: "USD", primary: false, available: 0 }] });
      case "/v1/countries/NG":
        return Response.json({ reserved_accounts: true });
      case "/v1/wallet/reserved-accounts":
        if (request.method === "POST") hasAccount = true;
        return Response.json({ data: hasAccount ? [{ id: "dva", bank_name: "Test Bank", account_number: "1000000000", account_name: "Demo Store", currency: "NGN" }] : [] });
      case "/v1/wallet/payment-methods":
        return Response.json({ data: [
          { id: "stripe", label: "Card", description: "Visa and Mastercard" },
          { id: "paystack", label: "Card, bank or USSD", description: "Card and bank transfers" },
        ] });
      case "/v1/wallet/top-ups":
        if (request.method === "POST") {
          submitted = await request.json();
          return Response.json({ id: "top-up", currency: "NGN", amount: 500000, status: "pending" });
        }
        return Response.json({ data: [], has_more: false });
      default:
        return Response.json({}, { status: 404 });
    }
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const page = () => render(<AdminProviders><TopUpsPage /></AdminProviders>);

it("shows branded gateways and sends the chosen gateway with the top-up", async () => {
  page();
  expect(await screen.findByRole("radio", { name: /Stripe/ })).toBeTruthy();
  expect(document.querySelector('img[src="/payment-gateways/paystack.svg"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Paystack/ }));
  fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "5000" } });
  fireEvent.click(screen.getByRole("button", { name: "Create test top-up" }));
  expect(await screen.findByText("Sandbox top-up created")).toBeTruthy();
  expect(submitted).toMatchObject({ amount: 500000, method: "paystack" });
  expect((await screen.findByRole("link", { name: "Get a virtual account" })).getAttribute("href")).toBe("/wallet/reserved-accounts");
});

it("opens existing accounts from the country wallet funding page", async () => {
  hasAccount = true;
  page();
  expect((await screen.findByRole("link", { name: "View virtual account" })).getAttribute("href")).toBe("/wallet/reserved-accounts");
});

it("keeps virtual accounts off the USD funding page", async () => {
  currency = "USD";
  hasAccount = true;
  page();
  expect(await screen.findByRole("radio", { name: /Paystack/ })).toBeTruthy();
  expect(screen.queryByRole("link", { name: /virtual account/i })).toBeNull();
});

it("requests a virtual account and displays the new bank account number", async () => {
  render(<AdminProviders><ReservedAccountsPage /></AdminProviders>);
  fireEvent.click(await screen.findByRole("button", { name: "Get my account number" }));
  expect(await screen.findByText("1000000000")).toBeTruthy();
});
