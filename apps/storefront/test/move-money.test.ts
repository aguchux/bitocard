// Move money posts the receiving wallet from React's state, never from the select: React resets a form after its
// action, which put the select back on its first wallet (US dollars) while the quote shown was for another, so the
// confirm was refused as "The rate changed" (found on the local copy, 15 November 2026).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import type { StoreWallet } from "@bitocard/api-client/storefront";

vi.mock("@/lib/wallet", () => ({ addWallet: async () => ({}), convertWallets: async () => ({}), openBankAccount: async () => ({}), removeWallet: async () => ({}), simulateDeposit: async () => {}, topUpWallet: async () => ({}) }));

const { MoveMoney } = await import("@/components/app/wallet-forms");

test("the receiving wallet is sent from a hidden field, the select has no name", () => {
  const wallet = {
    currency: "NGN",
    balance: 5_700_000,
    wallets: [
      { currency: "NGN", primary: true, balance: 5_700_000 },
      { currency: "USD", primary: false, balance: 0 },
      { currency: "KES", primary: false, balance: 0 },
    ],
  } as unknown as StoreWallet;
  const html = renderToStaticMarkup(createElement(MoveMoney, { wallet }));
  expect(html).toContain('<input type="hidden" name="to" value="USD"/>');
  expect(html).toMatch(/<select(?![^>]*name=)[^>]*>/);
  expect(html.match(/name="to"/g)).toHaveLength(1);
});
