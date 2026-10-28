import { createHash, createHmac } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect: (url: string) => redirect(url) }));

const { signRequest } = await import("@/lib/signing");
const { customerApi, nextStep } = await import("@/lib/customer");
const actions = await import("@/lib/account-actions");
const { requireCustomer } = await import("@/lib/account");
const { default: TwoStepPage } = await import("@/app/two-step/page");
const { default: SignInPage } = await import("@/app/signin/page");

const secret = "afrippa-site-secret-afrippa-site-secret-ab";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
type Call = [string, RequestInit & { headers: Record<string, string> }];
const calls = () => fetchMock.mock.calls as unknown as Call[];
const lastBody = () => JSON.parse(String(calls().at(-1)![1].body));
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

const state = (pending: boolean, extra: Record<string, unknown> = {}) => ({ object: "two_step_state", pending, setup_required: false, method: "email", method_not_allowed: false, ...extra });
const trader = (extra: Record<string, unknown> = {}) => ({
  object: "customer",
  id: "c1",
  email: "ada@example.com",
  name: "Ada Obi",
  email_verified: true,
  country: "NG",
  currency: "NGN",
  phone: null,
  phone_verified: false,
  created_at: "2026-10-01T00:00:00.000Z",
  two_step: state(false),
  ...extra,
});
const methods = [
  { method: "authenticator", available: true, reason: null },
  { method: "email", available: true, reason: null },
  { method: "sms", available: false, reason: "phone_required" },
];

beforeEach(() => {
  fetchMock.mockReset();
  redirect.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_URL", "https://afrippa.com");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", secret);
  setRequest({ "x-real-ip": "203.0.113.7" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("signing every request to Afrippa's routes", () => {
  test("the signature is the API's: the time, method, path and query, and the body's hash", () => {
    const at = 1_800_000_000_000;
    const body = '{"a":1}';
    const header = signRequest("k".repeat(32), { method: "post", url: "/v1/afrippa/p2p/orders?preview=1", body }, at);
    const t = "1800000000";
    const expected = createHmac("sha256", "k".repeat(32)).update(`${t}.POST./v1/afrippa/p2p/orders?preview=1.${createHash("sha256").update(body).digest("hex")}`).digest("hex");
    expect(header).toBe(`t=${t},v1=${expected}`);
  });

  test("a trader's call carries the session, the signature over exactly that request, the visitor's signed address and an Idempotency-Key", async () => {
    setRequest({ "x-real-ip": "203.0.113.7" }, { afr_session: "bcc_token" });
    fetchMock.mockImplementation(async () => json({ ok: true }));
    await customerApi("POST", "/v1/afrippa/p2p/ads", { side: "sell" });
    const [url, init] = calls()[0];
    expect(url).toBe("http://api.test/v1/afrippa/p2p/ads");
    expect(init.headers["bitocard-customer-session"]).toBe("bcc_token");
    const [t, v1] = init.headers["afrippa-signature"].split(",").map(part => part.split("=")[1]);
    const hash = createHash("sha256").update('{"side":"sell"}').digest("hex");
    expect(v1).toBe(createHmac("sha256", secret).update(`${t}.POST./v1/afrippa/p2p/ads.${hash}`).digest("hex"));
    expect(init.headers["bitocard-client"]).toMatch(/^t=\d+,ip=203\.0\.113\.7,v1=[0-9a-f]{64}$/);
    expect(init.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("signing in, signing up and two-step", () => {
  test("signing in keeps the session in this site's own cookie, then asks for the two-step code", async () => {
    fetchMock.mockImplementation(async () => json({ customer: trader(), session: { token: "bcc_new" }, two_step: state(true) }));
    await expect(actions.signIn({}, form({ email: "ada@example.com", password: "correct horse battery", next: "/ads" }))).rejects.toThrow("redirect:/two-step?next=%2Fads");
    expect(calls()[0][0]).toBe("http://api.test/v1/afrippa/account/signin");
    expect(request.set[0]).toMatchObject({ name: "afr_session", value: "bcc_new", options: { httpOnly: true, sameSite: "lax", path: "/" } });
    // An email not confirmed yet is confirmed first; a wrong password stays on the form.
    expect(nextStep({ email_verified: false, two_step: state(true) } as never, "/ads")).toBe("/verify?next=%2Fads");
    fetchMock.mockImplementation(async () => json({ error: { code: "invalid_credentials", message: "Wrong email or password." } }, 401));
    expect(await actions.signIn({}, form({ email: "ada@example.com", password: "nope" }))).toEqual({ error: "Wrong email or password.", field: null });
  });

  test("signing up sends the country (fixed for good) and goes on to confirm the email; never to another site after", async () => {
    fetchMock.mockImplementation(async () => json({ customer: trader({ email_verified: false }), session: { token: "bcc_new" }, two_step: state(true, { setup_required: true, method: null }) }));
    await expect(actions.signUp({}, form({ name: "Ada Obi", email: "ada@example.com", country: "NG", password: "correct horse battery", next: "//evil.example" }))).rejects.toThrow("redirect:/verify?next=%2F");
    expect(lastBody()).toEqual({ name: "Ada Obi", email: "ada@example.com", country: "NG", password: "correct horse battery" });
  });

  test("setting two-step up: an authenticator gets its key and QR code, then the recovery codes are shown once", async () => {
    setRequest({}, { afr_session: "bcc_token" });
    fetchMock.mockImplementationOnce(async () => json({ object: "two_step_setup", method: "authenticator", secret: "JBSWY3DPEHPK3PXP", otpauth_uri: "otpauth://totp/Afrippa:ada@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Afrippa", sent_to: null }));
    const chosen = await actions.chooseMethod({}, form({ method: "authenticator" }));
    expect(chosen.method).toBe("authenticator");
    expect(chosen.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(chosen.qr).toMatch(/^<svg/);
    fetchMock.mockImplementationOnce(async () => json({ object: "two_step_enabled", method: "authenticator", recovery_codes: ["abcd-1234", "efgh-5678"] }));
    const confirmed = await actions.confirmMethod(chosen, form({ code: "123456" }));
    expect(confirmed.recoveryCodes).toEqual(["abcd-1234", "efgh-5678"]);
    expect(calls().at(-1)![0]).toBe("http://api.test/v1/afrippa/account/two-step/setup/confirm");
  });

  test("the two-step code signs in; a method no longer allowed goes on to set another up", async () => {
    setRequest({}, { afr_session: "bcc_token" });
    fetchMock.mockImplementationOnce(async () => json({ object: "two_step_verified", method: "email", used: "code", signed_in: true, setup_required: false }));
    await expect(actions.verifyTwoStep({}, form({ code: "123456", next: "/wallets" }))).rejects.toThrow("redirect:/wallets");
    fetchMock.mockImplementationOnce(async () => json({ object: "two_step_verified", method: "sms", used: "code", signed_in: false, setup_required: true }));
    await expect(actions.verifyTwoStep({}, form({ code: "123456", next: "/wallets" }))).rejects.toThrow("redirect:/two-step?next=%2Fwallets");
  });

  test("the two-step page: methods to choose (with why one is closed) to set up, else the code with Send me a code", async () => {
    setRequest({}, { afr_session: "bcc_token" });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/afrippa/account")) return json(trader({ two_step: state(true, { setup_required: true, method: null }) }));
      return json({ object: "two_step", method: null, setup_required: true, method_not_allowed: false, sent_to: null, methods });
    });
    const setup = renderToStaticMarkup(await TwoStepPage({ searchParams: Promise.resolve({ next: "/ads" }) }));
    expect(setup).toContain("Set up two-step sign-in");
    expect(setup).toContain("An authenticator app");
    expect(setup).toContain("Confirm your mobile number first.");

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/v1/afrippa/account")) return json(trader({ two_step: state(true) }));
      return json({ object: "two_step", method: "email", setup_required: false, method_not_allowed: false, sent_to: "a•••@example.com", methods });
    });
    const verify = renderToStaticMarkup(await TwoStepPage({ searchParams: Promise.resolve({}) }));
    expect(verify).toContain("Confirm it is you");
    expect(verify).toContain("Send me a code");
    expect(verify).toContain("a•••@example.com");
  });

  test("account pages wait for two-step; a signed-in trader skips the sign-in page", async () => {
    setRequest({}, { afr_session: "bcc_token" });
    fetchMock.mockImplementation(async () => json(trader({ two_step: state(true) })));
    await expect(requireCustomer("/wallets")).rejects.toThrow("redirect:/two-step?next=%2Fwallets");
    fetchMock.mockImplementation(async () => json(trader()));
    expect((await requireCustomer("/wallets")).id).toBe("c1");
    await expect(SignInPage({ searchParams: Promise.resolve({ next: "/ads" }) })).rejects.toThrow("redirect:/ads");
    setRequest({});
    await expect(requireCustomer("/wallets")).rejects.toThrow("redirect:/signin?next=%2Fwallets&for=trade");
  });

  test("signing out ends the session with the API and forgets it here", async () => {
    setRequest({}, { afr_session: "bcc_token" });
    fetchMock.mockImplementation(async () => json({ object: "signed_out" }));
    await expect(actions.signOut()).rejects.toThrow("redirect:/");
    expect(calls()[0][0]).toBe("http://api.test/v1/afrippa/account/signout");
    expect(request.cookies.has("afr_session")).toBe(false);
  });
});
