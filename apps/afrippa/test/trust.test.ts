import type { ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect: (url: string) => redirect(url), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type), unstable_cache: (fn: () => unknown) => fn }));

const accountActions = await import("@/lib/account-actions");
const orders = await import("@/lib/orders");
const { GET: googleCallback } = await import("@/app/auth/google/callback/route");
const { default: SecurityPage } = await import("@/app/security/page");
const { default: TrustPage } = await import("@/app/trust/page");
const { default: NotificationsPage } = await import("@/app/notifications/page");
const { default: OrderPage } = await import("@/app/orders/[id]/page");
const { TraderTrust } = await import("@/components/trader-trust");
const { AccountArea } = await import("@/components/header");

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
const lastPost = () => calls().filter(call => call[1].method === "POST" || call[1].method === "DELETE").at(-1)!;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const orderId = "2a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const noticeId = "9a1c2b3a-4f5e-4d6c-8b7a-9f8e7d6c5b4a";
const twoStep = { object: "two_step_state", pending: false, setup_required: false, method: "email", method_not_allowed: false };
const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", phone: "+2348031234567", phone_verified: true, created_at: "2026-10-01T00:00:00.000Z", two_step: twoStep };
const methods = [
  { method: "authenticator", available: true, reason: null },
  { method: "email", available: true, reason: null },
  { method: "sms", available: true, reason: null },
];

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
  vi.stubEnv("AFRIPPA_URL", "https://afrippa.com");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
  setRequest({ "x-real-ip": "203.0.113.7" }, { afr_session: "bcc_token" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Google sign-in", () => {
  test("signing up needs the country first; starting keeps the state in this browser's own cookie and goes to Google", async () => {
    setRequest({});
    expect(await accountActions.startGoogle({}, form({ intent: "signup", next: "/ads" }))).toEqual({ error: "Choose your country first: it cannot be changed later.", field: "country" });
    expect(fetchMock).not.toHaveBeenCalled();

    answer({ "POST /v1/afrippa/account/google/start": { object: "google_sign_in", url: "https://accounts.google.com/o/oauth2/v2/auth?x=1", state: "state-from-the-api-123456789", expires_at: "2026-10-28T10:10:00.000Z" } });
    await expect(accountActions.startGoogle({}, form({ intent: "signup", country: "ng", next: "/ads" }))).rejects.toThrow("redirect:https://accounts.google.com/o/oauth2/v2/auth?x=1");
    expect(bodyOf(calls()[0])).toEqual({ intent: "signup" });
    const cookie = request.set.find(item => item.name === "afr_google")!;
    expect(JSON.parse(cookie.value)).toEqual({ state: "state-from-the-api-123456789", intent: "signup", next: "/ads", country: "NG" });
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600 });
  });

  test("the callback finishes only with this browser's state, then signs in and goes on to two-step", async () => {
    const flow = JSON.stringify({ state: "state-from-the-api-123456789", intent: "signup", next: "/ads", country: "NG" });
    setRequest({}, { afr_google: flow });
    const mismatch = await googleCallback(new Request("https://afrippa.com/auth/google/callback?code=abc&state=someone-elses-state-12345678"));
    expect(mismatch.headers.get("location")).toBe("https://afrippa.com/signup?next=%2Fads&auth_error=google_state_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(request.cookies.has("afr_google"), "the flow is used once").toBe(false);

    setRequest({}, { afr_google: flow });
    answer({ "POST /v1/afrippa/account/google/finish": { customer: { ...customer, email_verified: true }, session: { token: "bcc_google" }, two_step: { ...twoStep, pending: true, setup_required: true, method: null }, signed_up: true } });
    const done = await googleCallback(new Request("https://afrippa.com/auth/google/callback?code=abc&state=state-from-the-api-123456789"));
    expect(bodyOf(calls()[0])).toEqual({ state: "state-from-the-api-123456789", code: "abc", country: "NG" });
    expect(done.headers.get("location")).toBe("https://afrippa.com/two-step?next=%2Fads");
    expect(request.set.find(item => item.name === "afr_session")?.value).toBe("bcc_google");

    // A refusal comes back as a code the page words itself, never words from the address.
    setRequest({}, { afr_google: JSON.stringify({ state: "s".repeat(30), intent: "signin", next: "/", country: null }) });
    answer({ "POST /v1/afrippa/account/google/finish": json({ error: { code: "google_account_not_found", message: "x" } }, 400) });
    const refused = await googleCallback(new Request(`https://afrippa.com/auth/google/callback?code=abc&state=${"s".repeat(30)}`));
    expect(refused.headers.get("location")).toBe("https://afrippa.com/signin?next=%2F&auth_error=google_account_not_found");
  });
});

describe("security", () => {
  test("the page: the method with Change my method, recovery codes, the mobile number and the password", async () => {
    answer({ "/v1/afrippa/account": customer, "/v1/afrippa/account/two-step": { object: "two_step", method: "email", sent_to: "a•••@example.com", recovery_codes_left: 8, setup_required: false, methods } });
    const html = await render(await SecurityPage());
    expect(html).toContain("Codes by email, to a•••@example.com. 8 recovery codes left.");
    expect(html).toContain("Change my method");
    expect(html).toContain("A code from your current method");
    expect(html).toContain("+2348031234567, confirmed");
    expect(html).toContain("Change my password");
  });

  test("changing the method sends the current method's code; the password and the phone go to their routes", async () => {
    answer({
      "POST /v1/afrippa/account/two-step/setup": { object: "two_step_setup", method: "sms", secret: null, otpauth_uri: null, sent_to: "•••• 4567" },
      "POST /v1/afrippa/account/password/change": { object: "customer" },
      "POST /v1/afrippa/account/phone": { object: "phone_verification" },
    });
    expect((await accountActions.chooseMethod({}, form({ method: "sms", current_code: "123456" }))).sentTo).toBe("•••• 4567");
    expect(bodyOf(lastPost())).toEqual({ method: "sms", current_code: "123456" });
    expect((await accountActions.changePassword({}, form({ current_password: "old password!", password: "a new long password" }))).notice).toContain("signed out everywhere else");
    expect(bodyOf(lastPost())).toEqual({ current_password: "old password!", password: "a new long password" });
    expect((await accountActions.addPhone({}, form({ phone: "0803 123 4567" }))).sent).toBe(true);
    expect(bodyOf(lastPost())).toEqual({ phone: "0803 123 4567" });
  });
});

describe("trust", () => {
  test("the page: a restriction, strikes, blocked traders with Unblock, and reports with their outcome", async () => {
    answer({
      "/v1/afrippa/account": customer,
      "/v1/afrippa/p2p/standing": {
        object: "p2p_standing",
        strikes: 1,
        strike_limit: 3,
        strike_window_days: 90,
        cancellations_today: 0,
        cancellation_limit: 3,
        restriction: { code: "cool_off", until: "2026-10-29T10:00:00.000Z", message: "You lost an appeal: you can trade again after a 24-hour cool-off." },
        lost_appeals: [{ order_id: orderId, number: "ORD-000042", decided_at: "2026-10-28T10:00:00.000Z" }],
        upheld_reports: [],
      },
      "/v1/afrippa/p2p/blocks": { object: "list", data: [{ object: "p2p_block", nickname: "TraderZed", created_at: "2026-10-20T00:00:00.000Z" }] },
      "/v1/afrippa/p2p/reports": { object: "list", data: [{ id: "r1", number: "R-000007", reported: "TraderZed", reason: "fake_payment", status: "upheld", created_at: "2026-10-21T00:00:00.000Z" }] },
    });
    const html = await render(await TrustPage());
    expect(html).toContain("You lost an appeal");
    expect(html).toContain("1 of 3 strikes in 90 days");
    expect(html).toContain(`href="/orders/${orderId}"`);
    expect(html).toContain("Unblock TraderZed");
    expect(html).toContain("R-000007");
    expect(html).toContain("Said they paid but did not");
    expect(html).toContain("Upheld");
  });

  test("merchants: where the trader stands, Apply once every requirement is met, and the badge once approved", async () => {
    const requirements = [
      { key: "orders", label: "Completed orders", needed: "100", value: "120", met: true },
      { key: "completion", label: "Completion rate over 90 days", needed: "98%", value: "99%", met: true },
      { key: "strikes", label: "No current strikes", needed: "0", value: "0", met: true },
    ];
    const base = { "/v1/afrippa/account": customer, "/v1/afrippa/p2p/standing": { strikes: 0, strike_limit: 3, strike_window_days: 90, cancellations_today: 0, cancellation_limit: 3, restriction: null, lost_appeals: [], upheld_reports: [] }, "/v1/afrippa/p2p/blocks": { data: [] }, "/v1/afrippa/p2p/reports": { data: [] } };
    answer({ ...base, "/v1/afrippa/p2p/merchant": { object: "p2p_merchant_status", status: "none", applied_at: null, decided_at: null, reason: null, suspended_reason: null, eligible: true, requirements } });
    let html = await render(await TrustPage());
    expect(html).toContain("Completed orders");
    expect(html).toContain("120 of 100");
    expect(html).toContain("Apply to be a merchant");

    answer({ ...base, "/v1/afrippa/p2p/merchant": { object: "p2p_merchant_status", status: "suspended", applied_at: null, decided_at: null, reason: null, suspended_reason: "strike", eligible: false, requirements: [{ ...requirements[2], value: "1", met: false }] } });
    html = await render(await TrustPage());
    expect(html).toContain("suspended after a strike");
    expect(html).not.toContain("Apply to be a merchant");

    answer({ ...base, "/v1/afrippa/p2p/merchant": { object: "p2p_merchant_status", status: "active", applied_at: null, decided_at: null, reason: null, suspended_reason: null, eligible: true, requirements } });
    html = await render(await TrustPage());
    expect(html).toContain("> Merchant</span>You are an Afrippa merchant");
    expect(html).not.toContain("Completed orders");

    answer({ "POST /v1/afrippa/p2p/merchant/apply": { object: "p2p_merchant_status", status: "applied" } });
    expect(await orders.applyMerchant()).toEqual({ notice: "Your application is with Afrippa's team. We will tell you when they decide." });
    expect(revalidatePath).toHaveBeenCalledWith("/trust", undefined);
  });

  test("a trader's card signed in: their figures, feedback, Block and Report; their own card has neither; signed out asks to sign in", async () => {
    const card = { object: "p2p_trader", nickname: "TraderBola", orders_30d: 12, orders_total: 40, completion_rate_30d: 92.3, avg_pay_minutes: 6.4, avg_release_minutes: 0.5, feedback: { positive: 10, negative: 1 }, latest_feedback: [{ rating: "positive", comment: "Fast release.", from: "TraderAda", created_at: "2026-10-27T00:00:00.000Z" }] };
    answer({ "/v1/afrippa/account": customer, "/v1/afrippa/p2p/traders/TraderBola": card, "/v1/afrippa/p2p/blocks": { data: [] }, "/v1/afrippa/p2p/profile": { nickname: "TraderAda" } });
    const html = await render(await TraderTrust({ nickname: "TraderBola" }));
    expect(html).toContain("92.3%");
    expect(html).toContain("Under a minute");
    expect(html).toContain("10 good, 1 bad");
    expect(html).toContain("Fast release.");
    expect(html).toContain("Block TraderBola");
    expect(html).toContain("Report TraderBola");

    answer({ "/v1/afrippa/account": customer, "/v1/afrippa/p2p/traders/TraderBola": card, "/v1/afrippa/p2p/blocks": { data: [] }, "/v1/afrippa/p2p/profile": { nickname: "TraderBola" } });
    expect(await render(await TraderTrust({ nickname: "TraderBola" }))).not.toContain("Block TraderBola");

    setRequest({});
    expect(await render(await TraderTrust({ nickname: "TraderBola" }))).toContain('href="/signin?next=%2Ftrader%2FTraderBola"');
  });

  test("feedback, blocks and reports send what the API takes", async () => {
    answer({
      [`POST /v1/afrippa/p2p/orders/${orderId}/feedback`]: { object: "p2p_feedback" },
      "POST /v1/afrippa/p2p/blocks": { object: "p2p_block" },
      "DELETE /v1/afrippa/p2p/blocks/TraderZed": { object: "p2p_block" },
      "POST /v1/afrippa/p2p/reports": { object: "p2p_report", number: "R-000008" },
    });
    expect((await orders.giveFeedback({}, form({ id: orderId }))).field).toBe("rating");
    await orders.giveFeedback({}, form({ id: orderId, rating: "positive", comment: "Smooth." }));
    expect(bodyOf(lastPost())).toEqual({ rating: "positive", comment: "Smooth." });
    await orders.blockTrader({}, form({ nickname: "TraderZed" }));
    expect(bodyOf(lastPost())).toEqual({ nickname: "TraderZed" });
    expect((await orders.unblockTrader({}, form({ nickname: "TraderZed" }))).notice).toContain("no longer blocked");
    expect((await orders.reportTrader({}, form({ nickname: "TraderZed", reason: "fraud", details: "short" }))).field).toBe("details");
    expect((await orders.reportTrader({}, form({ nickname: "TraderZed", reason: "fraud", details: "Marked paid, nothing arrived.", order_id: orderId }))).notice).toContain("R-000008");
    expect(bodyOf(lastPost())).toEqual({ nickname: "TraderZed", reason: "fraud", details: "Marked paid, nothing arrived.", order_id: orderId });
    expect((await orders.blockTrader({}, form({ nickname: "no spaces allowed" }))).error).toBe("Choose a trader.");
  });

  test("a released order asks for feedback until it is given, and the other trader can be reported", async () => {
    const order = {
      object: "p2p_order", id: orderId, number: "ORD-000042", mode: "live", ad_id: "a", market: "NG", asset: "USDT", decimals: 6, currency: "NGN", side: "buy", status: "released",
      price: 165000, amount: "10.000000", fiat: 1650000, buyer_fee: "0.1", seller_fee: "0.2", received: "9.900000", escrow: "10.200000", payment_window: 15, pay_by: "2026-10-28T09:15:00.000Z",
      buyer: { nickname: "TraderAda" }, seller: { nickname: "TraderBola" }, payment_method: { kind: "bank", label: "Example Bank", currency: "NGN", hint: "•••• 1234", holder_name: "Bola", details: null },
      payer_name: "Ada Obi", paid_from: null, warnings: [], paid_at: null, appealed_at: null, appealed_by: null, appeal_reason: null, closed_at: "2026-10-28T09:20:00.000Z", cancel_reason: null, decision: null,
      feedback_given: false, created_at: "2026-10-28T09:00:00.000Z", updated_at: "2026-10-28T09:20:00.000Z",
    };
    const room = { object: "list", order_id: orderId, open: false, data: [] };
    answer({ "/v1/afrippa/account": customer, [`/v1/afrippa/p2p/orders/${orderId}`]: order, [`/v1/afrippa/p2p/orders/${orderId}/messages`]: room });
    const html = await render(await OrderPage({ params: Promise.resolve({ id: orderId }) }));
    expect(html).toContain("How was trading with TraderBola?");
    expect(html).toContain("Report TraderBola");
    answer({ "/v1/afrippa/account": customer, [`/v1/afrippa/p2p/orders/${orderId}`]: { ...order, feedback_given: true }, [`/v1/afrippa/p2p/orders/${orderId}/messages`]: room });
    expect(await render(await OrderPage({ params: Promise.resolve({ id: orderId }) }))).not.toContain("How was trading");
  });
});

describe("notifications", () => {
  test("the page lists notices, unread first marked; opening one marks it read and goes only to a page on this site", async () => {
    answer({
      "/v1/afrippa/account": customer,
      "/v1/afrippa/account/notifications?limit=50": { object: "list", data: [{ id: noticeId, severity: "warning", title: "The buyer paid", body: "Check your account.", link: `/orders/${orderId}`, mode: "live", read: false, created_at: "2026-10-28T09:05:00.000Z" }], unread_count: 1 },
      [`POST /v1/afrippa/account/notifications/${noticeId}/read`]: { object: "notification" },
    });
    const html = await render(await NotificationsPage());
    expect(html).toContain("The buyer paid");
    expect(html).toContain("(unread)");
    expect(html).toContain("Mark all read");

    await expect(orders.openNotification(form({ id: noticeId, link: `/orders/${orderId}` }))).rejects.toThrow(`redirect:/orders/${orderId}`);
    expect(lastPost()[0]).toBe(`http://api.test/v1/afrippa/account/notifications/${noticeId}/read`);
    await expect(orders.openNotification(form({ id: noticeId, link: "https://evil.example" }))).rejects.toThrow("redirect:/notifications");
  });

  test("the header's bell says how many are unread", async () => {
    answer({ "/v1/afrippa/account": customer, "/v1/afrippa/account/notifications/unread-count": { object: "unread_count", count: 3 } });
    const html = await render(await AccountArea());
    expect(html).toContain('aria-label="Notifications, 3 unread"');
  });
});
