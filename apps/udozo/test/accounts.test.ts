// Udozo's own accounts on udozo.com: sign-up with a fixed country, the session in this site's own `udz_customer`
// cookie, and the account's profile actions.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => redirect("not-found") }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string) => revalidatePath(path) }));

const actions = await import("@/lib/account-actions");
const { requireCustomer, requireSeller } = await import("@/lib/account");

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];
let reply: (url: string, method: string) => Response;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, phone: "+2348031234567", phone_verified: true, phone_verification_available: true, country: "NG", currency: "NGN", created_at: "2026-10-30T00:00:00Z" };
const session = { customer, session: { token: "bcc_new" } };

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" });
  redirect.mockClear();
  revalidatePath.mockClear();
  calls = [];
  reply = () => Response.json(session);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url, method);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("signing up on udozo.com", () => {
  test("posts the name, email, password and the chosen country (and the phone, when given), naming no store", async () => {
    await expect(actions.signUp({}, form({ name: " Ada Obi ", email: "ada@example.com", password: "a long password", country: "NG", phone: "+2348031234567", next: "/sell" }))).rejects.toThrow("redirect:/verify?next=%2Fsell");
    const call = calls[0]!;
    expect(`${call.method} ${call.url}`).toBe("POST https://api.test/v1/store/account/signup");
    expect(call.body).toEqual({ name: "Ada Obi", email: "ada@example.com", password: "a long password", country: "NG", phone: "+2348031234567" });
    expect(call.headers.get("bitocard-store")).toBeNull();
  });

  test("keeps the session in this site's own udz_customer cookie: host-only, httpOnly, Lax, 30 days", async () => {
    await expect(actions.signUp({}, form({ name: "Ada", email: "ada@example.com", password: "a long password", country: "GH" }))).rejects.toThrow("redirect:/verify?next=%2F");
    expect(calls[0]!.body).toMatchObject({ country: "GH" });
    expect((calls[0]!.body as Record<string, unknown>).phone).toBeUndefined();
    const cookie = request.set.find(item => item.name === "udz_customer")!;
    expect(cookie.value).toBe("bcc_new");
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 2592000 });
    expect(cookie.options?.domain).toBeUndefined();
    expect(request.set.map(item => item.name)).toEqual(["udz_customer"]);
  });

  test("no country, nothing leaves; the API's refusal names its field", async () => {
    expect(await actions.signUp({}, form({ name: "Ada", email: "ada@example.com", password: "a long password", country: "" }))).toEqual({ error: "Choose your country.", field: "country" });
    expect(calls).toHaveLength(0);
    reply = () => Response.json({ error: { code: "email_taken", message: "An account already uses this email.", param: "email" } }, { status: 409 });
    expect(await actions.signUp({}, form({ name: "Ada", email: "ada@example.com", password: "a long password", country: "NG" }))).toEqual({ error: "An account already uses this email.", field: "email" });
    expect(request.set).toEqual([]);
  });
});

describe("signing in and out", () => {
  test("signing in keeps the session and goes on, or to the emailed code first; never to another site", async () => {
    await expect(actions.signIn({}, form({ email: "ada@example.com", password: "pw", next: "/account/orders" }))).rejects.toThrow("redirect:/account/orders");
    expect(request.cookies.get("udz_customer")).toBe("bcc_new");
    reply = () => Response.json({ ...session, customer: { ...customer, email_verified: false } });
    await expect(actions.signIn({}, form({ email: "ada@example.com", password: "pw", next: "//evil.com" }))).rejects.toThrow("redirect:/verify?next=%2F");
    // The mobile texted at sign-up, still to confirm: to the code too.
    reply = () => Response.json({ ...session, customer: { ...customer, phone_verified: false } });
    await expect(actions.signIn({}, form({ email: "ada@example.com", password: "pw", next: "/account" }))).rejects.toThrow("redirect:/verify?next=%2Faccount");
    // Where the country cannot text, nothing waits for it.
    reply = () => Response.json({ ...session, customer: { ...customer, phone_verified: false, phone_verification_available: false } });
    await expect(actions.signIn({}, form({ email: "ada@example.com", password: "pw", next: "/account" }))).rejects.toThrow("redirect:/account");
  });

  test("confirming the account: the emailed code, then the texted one, then on", async () => {
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_s" });
    reply = () => Response.json({ ...customer, phone_verified: false });
    await expect(actions.verifyEmail({}, form({ code: "111111", next: "/sell" }))).rejects.toThrow("redirect:/verify?next=%2Fsell");
    reply = () => Response.json(customer);
    await expect(actions.confirmMobile({}, form({ code: "222222", next: "/sell" }))).rejects.toThrow("redirect:/sell");
    reply = () => Response.json({ object: "notice", phone: "+2348039998877" });
    expect(await actions.textMobileCode({}, form({ phone: "+2348039998877" }))).toEqual({ notice: "We sent a new code to +2348039998877.", phone: "+2348039998877" });
    expect(calls.map(call => call.url.replace("https://api.test", ""))).toEqual(["/v1/store/account/email/verify", "/v1/store/account/phone/verify", "/v1/store/account/phone"]);
    expect(calls[1]!.body).toEqual({ code: "222222" });
  });

  test("signing out ends the session at the API and drops the cookie", async () => {
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_old" });
    reply = () => Response.json({ object: "ok" });
    await expect(actions.signOut()).rejects.toThrow("redirect:/");
    expect(calls[0]!.url).toBe("https://api.test/v1/store/account/signout");
    expect(calls[0]!.headers.get("bitocard-customer-session")).toBe("bcc_old");
    expect(request.cookies.has("udz_customer")).toBe(false);
  });

  test("forgot password goes on to the code and new password; resetting signs in and opens the account", async () => {
    reply = () => Response.json({ object: "notice" });
    await expect(actions.forgotPassword({}, form({ email: "ada@example.com" }))).rejects.toThrow("redirect:/reset-password?email=ada%40example.com");
    reply = () => Response.json(session);
    await expect(actions.resetPassword({}, form({ email: "ada@example.com", code: "123456", password: "a new long password" }))).rejects.toThrow("redirect:/account");
    expect(calls[1]!.body).toEqual({ email: "ada@example.com", code: "123456", password: "a new long password" });
    expect(request.cookies.get("udz_customer")).toBe("bcc_new");
  });
});

describe("the account's profile", () => {
  test("name, phone and password go to their endpoints; the check returns to this site's own page", async () => {
    reply = () => Response.json(customer);
    expect(await actions.updateName({}, form({ name: "Ada O." }))).toEqual({ notice: "Saved." });
    reply = () => Response.json({ object: "notice", phone: "+2348031234567" });
    expect(await actions.addPhone({}, form({ phone: "+2348031234567" }))).toEqual({ notice: "We sent a code to +2348031234567." });
    reply = () => Response.json(customer);
    expect(await actions.changePassword({}, form({ current_password: "old", password: "a new long password" }))).toMatchObject({ notice: expect.stringContaining("Other devices") });
    reply = () => Response.json({ status: "in_progress", url: "https://verify.udozo.com/s#t=x" });
    await expect(actions.startVerification({}, form({ country: "NG", first_name: "Ada", last_name: "Obi", consent: "on" }))).rejects.toThrow("redirect:https://verify.udozo.com/s#t=x");
    expect(calls.map(call => call.url.replace("https://api.test", ""))).toEqual(["/v1/store/account/profile", "/v1/store/account/phone", "/v1/store/account/password/change", "/v1/store/account/verification"]);
    expect(calls[3]!.body).toEqual({ country: "NG", first_name: "Ada", last_name: "Obi", consent: true, redirect_url: "https://udozo.com/account/verification" });
  });
});

describe("every account page", () => {
  test("signed out: to sign in and back; an unconfirmed email: to its code", async () => {
    await expect(requireCustomer("/account/wallet")).rejects.toThrow("redirect:/signin?next=%2Faccount%2Fwallet");
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_s" });
    reply = () => Response.json({ ...customer, email_verified: false });
    await expect(requireCustomer("/account/wallet")).rejects.toThrow("redirect:/verify?next=%2Faccount%2Fwallet");
    reply = () => Response.json({ ...customer, phone: null, phone_verified: false });
    await expect(requireCustomer("/account/wallet")).rejects.toThrow("redirect:/verify?next=%2Faccount%2Fwallet");
  });

  test("selling needs the customer's own country to be an open market", async () => {
    setRequest({ host: "udozo.com" }, { udz_customer: "bcc_s" });
    const nigeria = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 3, safe_pay: true, install_prompt: false };
    reply = url => (url.endsWith("/v1/classifieds/markets") ? Response.json({ object: "list", data: [nigeria], showcase: false }) : Response.json(customer));
    expect((await requireSeller("/sell")).market.country).toBe("NG");
  });
});
