import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
// The pages render without a mounted app router: an open order's refresher only needs `refresh`.
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect: (url: string) => redirect(url), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type), unstable_cache: (fn: () => unknown) => fn }));

const orders = await import("@/lib/orders");
const { tradeActions } = await import("@afrippa/ui/trade-actions");
const { default: TakePage } = await import("@/app/take/[ad]/page");
const { default: OrderPage } = await import("@/app/orders/[id]/page");
const { default: OrdersPage } = await import("@/app/orders/page");
const { default: PaymentMethodsPage } = await import("@/app/payment-methods/page");
const { GET: fileRoute } = await import("@/app/orders/[id]/files/[message]/route");

/** Renders a page as the server would, waiting for its async parts. */
async function render(element: ReactElement) {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
type Call = [string, RequestInit & { headers: Record<string, string> }];
const calls = () => fetchMock.mock.calls as unknown as Call[];
const bodyOf = (call: Call) => JSON.parse(String(call[1].body));
const form = (values: Record<string, string | string[] | File>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) value.forEach(item => data.append(key, item));
    else data.set(key, value);
  }
  return data;
};

const adId = "1a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const orderId = "2a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const theirBank = "3a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const myBank = "4a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const myWallet = "5a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const messageId = "6a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";

const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", phone: null, phone_verified: false, created_at: "2026-10-01T00:00:00.000Z", two_step: { object: "two_step_state", pending: false, setup_required: false, method: "email", method_not_allowed: false } };
const ad = (extra: Record<string, unknown> = {}) => ({
  object: "p2p_ad",
  id: adId,
  mode: "live",
  side: "sell",
  asset: "USDT",
  decimals: 6,
  currency: "NGN",
  country: "NG",
  market: "NG",
  price: 165000,
  available: "50.000000",
  total: "50.000000",
  filled: "0.000000",
  min_fiat: 100000,
  max_fiat: 5000000,
  terms: "Pay from your own account only.",
  status: "active",
  mine: false,
  trader: { nickname: "TraderBola", trades_30d: 4, trades_total: 9 },
  payment_window: 15,
  payment_methods: [{ id: theirBank, kind: "bank", label: "Example Bank", currency: "NGN", reversible: false }],
  fee_locked: null,
  created_at: "2026-10-27T00:00:00.000Z",
  updated_at: "2026-10-27T00:00:00.000Z",
  ...extra,
});
const method = (id: string, extra: Record<string, unknown> = {}) => ({
  object: "p2p_payment_method",
  id,
  kind: "bank",
  currency: "NGN",
  label: "My Bank",
  hint: "•••• 6789",
  holder_name: "Ada Obi",
  reversible: false,
  usable: true,
  usable_from: "2026-10-26T00:00:00.000Z",
  created_at: "2026-10-25T00:00:00.000Z",
  ...extra,
});
const order = (extra: Record<string, unknown> = {}) => ({
  object: "p2p_order",
  id: orderId,
  number: "ORD-000042",
  mode: "live",
  ad_id: adId,
  market: "NG",
  asset: "USDT",
  decimals: 6,
  currency: "NGN",
  side: "buy",
  status: "pending_payment",
  price: 165000,
  amount: "10.000000",
  fiat: 1650000,
  buyer_fee: "0.100000",
  seller_fee: "0.200000",
  received: "9.900000",
  escrow: "10.200000",
  payment_window: 15,
  pay_by: new Date(Date.now() + 10 * 60_000).toISOString(),
  buyer: { nickname: "TraderAda" },
  seller: { nickname: "TraderBola" },
  payment_method: { kind: "bank", label: "Example Bank", currency: "NGN", hint: "•••• 1234", holder_name: "Bola Seller", details: { kind: "bank", bank_name: "Example Bank", bank_code: null, account_number: "0123451234" } },
  payer_name: "Ada Obi",
  paid_from: null,
  warnings: [],
  paid_at: null,
  appealed_at: null,
  appealed_by: null,
  appeal_reason: null,
  closed_at: null,
  cancel_reason: null,
  decision: null,
  created_at: "2026-10-28T09:00:00.000Z",
  updated_at: "2026-10-28T09:00:00.000Z",
  ...extra,
});
const room = (open = true) => ({ object: "list", order_id: orderId, open, data: [{ object: "p2p_order_message", id: messageId, from: "system", body: "Order opened.", file: null, created_at: "2026-10-28T09:00:00.000Z" }] });

/** Answers each API path; anything else is a 404. */
function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const path = url.replace("http://api.test", "");
    const key = `${init.method ?? "GET"} ${path}`;
    const found = key in routes ? routes[key] : path in routes ? routes[path] : undefined;
    if (found instanceof Response) return found;
    return found === undefined ? json({ error: { code: "resource_missing", message: "Not found." } }, 404) : json(found);
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  redirect.mockClear();
  revalidatePath.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
  setRequest({ "x-real-ip": "203.0.113.7" }, { afr_session: "bcc_token" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("payment methods", () => {
  test("adding one sends only its kind's fields, in the currency chosen; the list shows the hint and when it is usable", async () => {
    answer({ "POST /v1/afrippa/p2p/payment-methods": method(myBank, { usable: false, usable_from: "2026-10-29T10:00:00.000Z" }) });
    const saved = await orders.addPaymentMethod({}, form({ kind: "bank", currency: "ngn", bank_name: "My Bank", account_number: "0123456789", network: "MTN", nonce: "nonce-12345678", code: " ABCD-1234 " }));
    expect(saved.notice).toContain("My Bank •••• 6789 is saved");
    const [, init] = calls()[0];
    expect(bodyOf(calls()[0])).toEqual({ kind: "bank", currency: "NGN", bank_name: "My Bank", account_number: "0123456789", code: "abcd-1234" });
    expect(init.headers["idempotency-key"]).toBe("nonce-12345678");
    expect(revalidatePath).toHaveBeenCalledWith("/payment-methods", undefined);

    answer({ "/v1/afrippa/account": customer, "/v1/afrippa/p2p/payment-methods": { object: "list", data: [method(myBank, { usable: false, usable_from: "2026-10-29T10:00:00.000Z" }), method(myWallet, { kind: "named", label: "PayPal", hint: "ad•••", currency: "USD", reversible: true })] } });
    const html = await render(await PaymentMethodsPage());
    expect(html).toContain("My Bank");
    expect(html).toContain("•••• 6789");
    expect(html).toContain("Usable from");
    expect(html).toContain("can be taken back by the payer");
    expect(html).not.toContain("0123456789");
  });

  test("a refusal names its field; a lost session signs in again", async () => {
    answer({ "POST /v1/afrippa/p2p/payment-methods": json({ error: { code: "parameter_invalid", message: "Enter the account number: 6 to 20 digits.", param: "account_number" } }, 400) });
    expect(await orders.addPaymentMethod({}, form({ kind: "bank", currency: "NGN", bank_name: "B", account_number: "6789" }))).toEqual({ error: "Enter a code from your two-step method.", field: "code" });
    expect(await orders.addPaymentMethod({}, form({ kind: "bank", currency: "NGN", bank_name: "B", account_number: "1", code: "123456" }))).toEqual({ error: "Enter the account number: 6 to 20 digits.", field: "account_number" });
    answer({ [`DELETE /v1/afrippa/p2p/payment-methods/${myBank}`]: json({ error: { code: "authentication_required", message: "Sign in." } }, 401) });
    await expect(orders.removePaymentMethod({}, form({ id: myBank }))).rejects.toThrow("redirect:/signin?next=%2Fpayment-methods");
  });
});

describe("posting an escrow ad", () => {
  test("the ad carries its payment methods and window; none chosen is refused here", async () => {
    answer({ "POST /v1/afrippa/p2p/ads": ad({ mine: true }) });
    const { customerApi } = await import("@/lib/customer");
    const trade = tradeActions({ api: customerApi, paths: { ads: "/ads", signIn: next => `/signin?next=${next}`, refresh: ["/"] }, redirect: redirect as never, revalidate: () => undefined });
    const fields = { side: "sell", asset: "USDT", currency: "NGN", price: "1650", amount: "50", min_fiat: "1000", max_fiat: "50000" };
    expect(await trade.postAd(form(fields))).toEqual({ error: "Choose at least one payment method for this ad.", field: "payment_method_ids" });
    await expect(trade.postAd(form({ ...fields, payment_method_ids: [myBank, myWallet], payment_window: "30" }))).rejects.toThrow("redirect:/ads?posted=1");
    expect(bodyOf(calls()[0])).toMatchObject({ side: "sell", price: 165000, amount: "50", payment_method_ids: [myBank, myWallet], payment_window: 30 });
  });
});

describe("taking an ad", () => {
  test("buying from a sell ad: its accounts to pay into, then the API's own preview and the order opened on confirm", async () => {
    answer({
      "/v1/afrippa/account": customer,
      [`/v1/afrippa/p2p/ads/${adId}`]: ad(),
      "POST /v1/afrippa/p2p/orders": { object: "p2p_order_preview", asset: "USDT", currency: "NGN", price: 165000, amount: "10.000000", fiat: 1650000, buyer_fee: "0.100000", seller_fee: "0.200000", received: "9.900000", payment_window: 15 },
    });
    const first = await render(await TakePage({ params: Promise.resolve({ ad: adId }), searchParams: Promise.resolve({}) }));
    expect(first).toContain("Buy USDT from TraderBola");
    expect(first).toContain("Example Bank");
    expect(first).toContain("Pay from your own account only.");
    expect(first).not.toContain("Open the order");

    const previewed = await render(await TakePage({ params: Promise.resolve({ ad: adId }), searchParams: Promise.resolve({ fiat: "16500", method: theirBank }) }));
    expect(bodyOf(calls().find(call => call[1].method === "POST")!)).toEqual({ ad_id: adId, price: 165000, fiat: 1650000, payment_method_id: theirBank, preview: true });
    expect(previewed).toContain("9.9");
    expect(previewed).toContain("Open the order");

    answer({ "POST /v1/afrippa/p2p/orders": order() });
    await expect(orders.openOrder({ nonce: "nonce-abcdefgh" }, form({ ad_id: adId, price: "165000", fiat: "16500", payment_method_id: theirBank, nonce: "nonce-abcdefgh" }))).rejects.toThrow(`redirect:/orders/${orderId}`);
    expect(bodyOf(calls().at(-1)!)).toEqual({ ad_id: adId, price: 165000, fiat: 1650000, payment_method_id: theirBank });
    expect(calls().at(-1)![1].headers["idempotency-key"]).toBe("nonce-abcdefgh");
  });

  test("selling to a buy ad: only the trader's own usable accounts in its currency the buyer can pay into", async () => {
    answer({
      "/v1/afrippa/account": customer,
      [`/v1/afrippa/p2p/ads/${adId}`]: ad({ side: "buy" }),
      "/v1/afrippa/p2p/payment-methods": {
        object: "list",
        data: [method(myBank), method(myWallet, { kind: "mobile_money", label: "MTN", hint: "•••• 5555" }), method("7a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a", { label: "New Bank", usable: false })],
      },
    });
    const html = await render(await TakePage({ params: Promise.resolve({ ad: adId }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Sell USDT to TraderBola");
    expect(html).toContain("My Bank •••• 6789");
    expect(html).not.toContain("MTN");
    expect(html).not.toContain("New Bank");
  });

  test("a refused open keeps the API's message and gives a new nonce; an ad no longer on offer says so", async () => {
    answer({ "POST /v1/afrippa/p2p/orders": json({ error: { code: "price_changed", message: "The price of this ad changed.", param: "price" } }, 409) });
    const refused = await orders.openOrder({ nonce: "nonce-abcdefgh" }, form({ ad_id: adId, price: "165000", fiat: "16500", payment_method_id: theirBank, nonce: "nonce-abcdefgh" }));
    expect(refused.error).toBe("The price of this ad changed.");
    expect(refused.nonce).not.toBe("nonce-abcdefgh");

    answer({ "/v1/afrippa/account": customer, [`/v1/afrippa/p2p/ads/${adId}`]: json({ error: { code: "ad_unavailable", message: "This ad is no longer available. Choose another." } }, 409) });
    expect(await render(await TakePage({ params: Promise.resolve({ ad: adId }), searchParams: Promise.resolve({}) }))).toContain("This ad is no longer available");
  });
});

describe("an order", () => {
  test("the buyer, before paying: the seller's account in full, the name to pay from, then I have paid and cancel", async () => {
    answer({
      "/v1/afrippa/account": customer,
      [`/v1/afrippa/p2p/orders/${orderId}`]: order(),
      [`/v1/afrippa/p2p/orders/${orderId}/messages`]: room(),
      "/v1/afrippa/p2p/payment-methods": { object: "list", data: [method(myBank), method(myWallet, { kind: "mobile_money", label: "MTN" })] },
    });
    const html = await render(await OrderPage({ params: Promise.resolve({ id: orderId }) }));
    expect(html).toContain("Pay the seller");
    expect(html).toContain("0123451234");
    expect(html).toContain("Bola Seller");
    expect(html).toContain("Ada Obi");
    expect(html).toContain("I have paid");
    expect(html).toContain("My Bank •••• 6789");
    expect(html).not.toContain(">MTN");
    expect(html).toContain("Cancel the order");
    expect(html).toContain("Order opened.");
  });

  test("the seller, once paid: who paid and from where, then release only after checking", async () => {
    answer({
      "/v1/afrippa/account": customer,
      [`/v1/afrippa/p2p/orders/${orderId}`]: order({ side: "sell", status: "paid", paid_from: { kind: "bank", label: "Ada Bank", hint: "•••• 4321", holder_name: "Ada Obi" }, warnings: ["reversible_payment"] }),
      [`/v1/afrippa/p2p/orders/${orderId}/messages`]: room(),
    });
    const html = await render(await OrderPage({ params: Promise.resolve({ id: orderId }) }));
    expect(html).toContain("Check your account, then release");
    expect(html).toContain("Ada Bank •••• 4321");
    expect(html).toContain("can be taken back by the payer");
    expect(html).toContain("Release the coins");
    expect(html).toContain("Send me a code");
    expect(html).toContain('name="code"');
    expect(html).toContain("Something is wrong? Appeal");
  });

  test("a closed order: what happened, and its room read-only", async () => {
    answer({
      "/v1/afrippa/account": customer,
      [`/v1/afrippa/p2p/orders/${orderId}`]: order({ status: "cancelled", cancel_reason: "expired", payment_method: { ...order().payment_method, details: null } }),
      [`/v1/afrippa/p2p/orders/${orderId}/messages`]: room(false),
    });
    const html = await render(await OrderPage({ params: Promise.resolve({ id: orderId }) }));
    expect(html).toContain("Expired");
    expect(html).toContain("read-only");
    expect(html).not.toContain("0123451234");
    expect(html).not.toContain("Release the coins");
  });

  test("the steps: paid names the account paid from, release needs the check and a fresh code, appeal needs a reason", async () => {
    answer({ [`POST /v1/afrippa/p2p/orders/${orderId}/paid`]: order({ status: "paid" }), [`POST /v1/afrippa/p2p/orders/${orderId}/release`]: order({ status: "released" }), [`POST /v1/afrippa/p2p/orders/${orderId}/appeal`]: order({ status: "appealed" }) });
    expect((await orders.markPaid({}, form({ id: orderId }))).field).toBe("payment_method_id");
    expect(await orders.markPaid({}, form({ id: orderId, payment_method_id: myBank }))).toEqual({ notice: "Done." });
    expect(bodyOf(calls()[0])).toEqual({ payment_method_id: myBank });
    expect((await orders.releaseOrder({}, form({ id: orderId }))).field).toBe("payer_checked");
    expect((await orders.releaseOrder({}, form({ id: orderId, payer_checked: "yes" }))).field).toBe("code");
    await orders.releaseOrder({}, form({ id: orderId, payer_checked: "yes", code: "123456" }));
    expect(bodyOf(calls()[1])).toEqual({ payer_checked: true, code: "123456" });
    expect((await orders.appealOrder({}, form({ id: orderId, reason: "short" }))).field).toBe("reason");
    await orders.appealOrder({}, form({ id: orderId, reason: "The seller has not released after I paid." }));
    expect(revalidatePath).toHaveBeenCalledWith(`/orders/${orderId}`, undefined);
  });

  test("Send me a code asks for a confirmation code, worded so, and says where it went", async () => {
    const { sendConfirmCode } = await import("@/lib/account-actions");
    answer({ "POST /v1/afrippa/account/two-step/challenge": { object: "two_step_challenge", method: "email", sent: true, sent_to: "a•••@example.com" } });
    expect(await sendConfirmCode()).toEqual({ notice: "We have sent a code to a•••@example.com." });
    expect(bodyOf(calls()[0])).toEqual({ purpose: "confirm" });
  });

  test("the room: text as a message, a file as a base64 attachment; polling asks only for what is new", async () => {
    const sent = { object: "p2p_order_message", id: messageId, from: "you", body: "Paid", file: null, created_at: "2026-10-28T09:01:00.000Z" };
    answer({ [`POST /v1/afrippa/p2p/orders/${orderId}/messages`]: sent, [`POST /v1/afrippa/p2p/orders/${orderId}/attachments`]: { ...sent, file: { name: "proof.png" } } });
    expect((await orders.sendToRoom({}, form({ id: orderId, body: "Paid" }))).sent?.id).toBe(messageId);
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "proof.png", { type: "image/png" });
    await orders.sendToRoom({}, form({ id: orderId, body: "", file: png }));
    expect(bodyOf(calls()[1])).toEqual({ file_name: "proof.png", content_type: "image/png", data: "iVBORw==" });
    const exe = new File(["MZ"], "run.exe", { type: "application/x-msdownload" });
    expect((await orders.sendToRoom({}, form({ id: orderId, file: exe }))).field).toBe("file");

    answer({ [`/v1/afrippa/p2p/orders/${orderId}/messages?after=${messageId}`]: { object: "list", order_id: orderId, open: true, data: [] } });
    expect((await orders.roomSince(orderId, messageId))?.open).toBe(true);
    expect(await orders.roomSince("not-an-id", null)).toBeNull();
  });

  test("a room's file is passed on sandboxed and never cached; other ids are not found", async () => {
    answer({ [`/v1/afrippa/p2p/orders/${orderId}/files/${messageId}`]: new Response("PNG", { headers: { "content-type": "image/png", "content-disposition": 'inline; filename="proof.png"' } }) });
    const res = await fileRoute(new Request("https://afrippa.com/x"), { params: Promise.resolve({ id: orderId, message: messageId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(calls()[0][1].headers["bitocard-customer-session"]).toBe("bcc_token");
    expect((await fileRoute(new Request("https://afrippa.com/x"), { params: Promise.resolve({ id: "x", message: messageId }) })).status).toBe(404);
  });

  test("the list: open orders first, each saying what to do now", async () => {
    answer({
      "/v1/afrippa/account": customer,
      "/v1/afrippa/p2p/orders?status=open": { object: "list", data: [order()] },
      "/v1/afrippa/p2p/orders?status=closed&limit=30": { object: "list", data: [order({ id: "8a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a", status: "released" })] },
    });
    const html = await render(await OrdersPage());
    expect(html).toContain("Pay the seller");
    expect(html).toContain("Completed");
    expect(html).toContain(`href="/orders/${orderId}"`);
  });
});
