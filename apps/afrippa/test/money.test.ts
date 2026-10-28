import { createElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect: (url: string) => redirect(url) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type), unstable_cache: (fn: () => unknown) => fn }));

const { default: DepositPage } = await import("@/app/deposit/page");
const { default: WithdrawPage } = await import("@/app/withdraw/page");
const { default: ReviewPage } = await import("@/app/withdraw/confirm/page");
const { default: WithdrawalPage } = await import("@/app/withdrawals/[id]/page");
const money = await import("@/lib/money");
const { MoneyActionsProvider } = await import("@afrippa/ui/money-forms");

/**
 * Renders as the root layout does (the shared money forms get this site's actions), waiting for the async parts the
 * pages are made of, as the server would.
 */
async function render(element: ReactElement) {
  const stream = await renderToReadableStream(createElement(MoneyActionsProvider, { actions: money }, element));
  await stream.allReady;
  // Without the markers React puts between neighbouring text, so assertions read as the page does.
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", phone: null, phone_verified: false, created_at: "2026-10-01T00:00:00.000Z", two_step: { object: "two_step_state", pending: false, setup_required: false, method: "email", method_not_allowed: false } };
const coin = { object: "crypto_balance", asset: "USDT", name: "Tether", decimals: 6, enabled: true, available: "12.500000", locked: "0.000000", frozen: "0.000000", withdrawing: "0.000000", total: "12.500000" };
const overview = (extra: Record<string, unknown> = {}) => ({
  object: "crypto_wallets",
  mode: "live",
  country: "NG",
  currency: "NGN",
  enabled: true,
  p2p_enabled: true,
  global_enabled: true,
  verified: true,
  declaration: { version: "2026-10-27", declared: true },
  frozen: false,
  assets: [coin],
  ...extra,
});
const address = "0d1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const withdrawal = {
  object: "crypto_withdrawal",
  id: "7a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a",
  number: "CW-000012",
  mode: "live",
  asset: "USDT",
  chain: "TRON",
  network: "TRON",
  address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8",
  amount: "10",
  fee: "1",
  status: "awaiting_code",
  tx_hash: null,
  created_at: "2026-10-27T10:00:00.000Z",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
type Call = [string, RequestInit & { headers: Record<string, string> }];
const calls = () => fetchMock.mock.calls as unknown as Call[];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

/** The signed-in customer's API, from fixtures; `wallets` overrides the crypto overview. */
const answer = (wallets = overview()) =>
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path === "/v1/afrippa/account") return json(customer);
    if (path === "/v1/afrippa/crypto") return json(wallets);
    if (path.startsWith("/v1/afrippa/crypto/deposit-networks")) return json({ object: "list", data: [{ object: "crypto_network", chain: "TRON", name: "TRON", token: "TRC-20", confirmations: 19 }] });
    if (path === "/v1/afrippa/crypto/deposit-addresses") return json({ object: "crypto_deposit_address", asset: "USDT", chain: "TRON", address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", contract: null });
    if (path === "/v1/afrippa/crypto/deposits") return json({ object: "list", data: [{ object: "crypto_deposit", id: "d1", asset: "USDT", network: "TRON", amount: "5", status: "pending", confirmations: 3, confirmations_needed: 19, created_at: "2026-10-27T10:00:00.000Z" }] });
    if (path.startsWith("/v1/afrippa/crypto/withdrawal-networks")) return json({ object: "list", remaining_today: "500", data: [{ object: "crypto_withdrawal_network", chain: "TRON", name: "TRON", fee: "1", minimum: "5" }] });
    if (path === "/v1/afrippa/crypto/withdrawal-addresses") return json({ object: "list", data: [{ object: "crypto_withdrawal_address", id: address, chain: "TRON", label: "Cold", address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", ready: true, usable_from: "2026-10-26T10:00:00.000Z" }] });
    if (path === "/v1/afrippa/crypto/withdrawals" && init?.method === "POST") {
      return json({ object: "crypto_withdrawal_preview", asset: "USDT", chain: "TRON", network: "TRON", address: "TJRabPrwbZy45sbavfcjinPJC18kjpRTv8", amount: "10", fee: "1", total: "11", needs_approval: true });
    }
    if (path === "/v1/afrippa/crypto/withdrawals") return json({ object: "list", data: [withdrawal] });
    if (path === `/v1/afrippa/crypto/withdrawals/${withdrawal.id}`) return json(withdrawal);
    return json({ error: { code: "resource_missing", message: "Not found." } }, 404);
  });


beforeEach(() => {
  fetchMock.mockReset();
  redirect.mockClear();
  revalidatePath.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_URL", "https://afrippa.com");
  setRequest({}, { afr_session: "bcc_token" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("money in and out, on this site", () => {
  test("signed out, every money page signs in here first and comes back", async () => {
    setRequest({});
    await expect(DepositPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/signin?next=%2Fdeposit&for=trade");
  });

  test("depositing: the coin, its network, then the customer's own address with its QR code, and recent deposits", async () => {
    answer();
    const html = await render(await DepositPage({ searchParams: Promise.resolve({ asset: "usdt" }) }));
    expect(html).toContain("Deposit crypto");
    expect(html).toContain('href="/deposit?asset=USDT&amp;chain=TRON"');
    expect(html).toContain("Show wallet address");
    expect(html).toContain("TJRabPrwbZy45sbavfcjinPJC18kjpRTv8");
    expect(html).toContain("<svg");
    expect(html).toContain("Confirming 3/19");
    const asked = calls().find(([url]) => url.endsWith("/v1/afrippa/crypto/deposit-addresses"))!;
    expect(JSON.parse(String(asked[1].body))).toEqual({ asset: "USDT", chain: "TRON" });
  });

  test("not verified yet: the identity check on this site, and nothing else is asked", async () => {
    answer(overview({ verified: false }));
    const html = await render(await DepositPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/verification"');
    expect(calls().some(([url]) => url.includes("deposit-addresses"))).toBe(false);
  });

  test("withdrawing: the network with its fee, saved addresses, the form, and recent withdrawals on this site", async () => {
    answer();
    const html = await render(await WithdrawPage({ searchParams: Promise.resolve({ asset: "USDT" }) }));
    expect(html).toContain("Fee 1.00 USDT");
    expect(html).toContain("You can send up to 500.00 USDT more today");
    expect(html).toContain(`value="${address}"`);
    expect(html).toContain("Review withdrawal");
    expect(html).toContain(`href="/withdrawals/${withdrawal.id}"`);
    expect(html).toContain("Waiting for your code");
  });

  test("the review shows the total and asks for the code; a withdrawal waiting for its code can be confirmed or cancelled", async () => {
    answer();
    const review = await render(await ReviewPage({ searchParams: Promise.resolve({ asset: "USDT", chain: "TRON", address, amount: "10" }) }));
    expect(review).toContain("Taken from your wallet");
    expect(review).toContain("Email me the code to send it");
    expect(review).toContain("Afrippa checks this withdrawal before it is sent");
    const page = await render(await WithdrawalPage({ params: Promise.resolve({ id: withdrawal.id }) }));
    expect(page).toContain("Withdrawal CW-000012");
    expect(page).toContain("Code from your email");
    expect(page).toContain("Cancel this withdrawal");
    await expect(WithdrawalPage({ params: Promise.resolve({ id: "nope" }) })).rejects.toThrow();
  });

  test("the actions work on this site's pages: the review, the withdrawal, and signing in here", async () => {
    answer();
    await expect(money.reviewWithdrawal({}, form({ asset: "USDT", chain: "TRON", address_id: address, amount: "1,000.5" }))).rejects.toThrow(
      `redirect:/withdraw/confirm?asset=USDT&chain=TRON&address=${address}&amount=1000.5`,
    );
    fetchMock.mockImplementationOnce(async () => json({ ...withdrawal, object: "crypto_withdrawal" }));
    await expect(money.createWithdrawal({}, form({ asset: "USDT", chain: "TRON", address_id: address, amount: "10", nonce: address }))).rejects.toThrow(`redirect:/withdrawals/${withdrawal.id}`);
    expect(calls().at(-1)![1].headers["idempotency-key"]).toBe(address);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
    fetchMock.mockImplementationOnce(async () => json({ error: { code: "authentication_required", message: "Sign in." } }, 401));
    await expect(money.addWithdrawalAddress({}, form({ chain: "TRON", address, label: "Mine" }))).rejects.toThrow("redirect:/signin?next=%2Fwithdraw");
  });
});
