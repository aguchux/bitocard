// "Continue with Google" on udozo.com: the start keeps the API's one-time state in this site's own `udz_google` cookie
// and sends the browser to Google; the callback finishes only with that same state, keeps the session, and sends a new
// account on to onboarding (its name and country, then its mobile) before anything else.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => redirect("not-found") }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { continueWithGoogle } = await import("@/lib/google-actions");
const { GET } = await import("@/app/auth/google/callback/route");
const { GoogleButton } = await import("@/components/account/google-button");
const { confirmationPending } = await import("@/lib/customer");

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let reply: (url: string) => Response;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const newCustomer = { object: "customer", id: "c9", email: "ngozi@gmail.com", name: "Ngozi Okafor", first_name: "Ngozi", last_name: "Okafor", name_confirmed: false, email_verified: true, phone: null, phone_verified: false, phone_verification_available: false, country: null, currency: null, created_at: "2026-10-31T00:00:00Z" };

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" });
  redirect.mockClear();
  calls = [];
  reply = () => Response.json({ object: "google_sign_in", url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=st_abc", state: "st_abcdefghijklmnopqrstuvwxyz" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("starting with Google", () => {
  test("asks the API, keeps the state (with the intent, next and an invite's ref) in udz_google, and goes to Google", async () => {
    await expect(continueWithGoogle(form({ intent: "signup", next: "/sell", ref: "abc123def0" }))).rejects.toThrow("redirect:https://accounts.google.com/o/oauth2/v2/auth?client_id=x&state=st_abc");
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/store/account/google/start", method: "POST", body: { intent: "signup" } });
    const cookie = request.set.find(item => item.name === "udz_google")!;
    expect(JSON.parse(cookie.value)).toEqual({ state: "st_abcdefghijklmnopqrstuvwxyz", intent: "signup", next: "/sell", ref: "abc123def0" });
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600 });
  });

  test("a refusal (Google not set up yet) returns to the page with its code; another site's next is never followed", async () => {
    reply = () => Response.json({ error: { code: "google_not_configured", message: "Not yet." } }, { status: 503 });
    await expect(continueWithGoogle(form({ intent: "signin", next: "//evil.example" }))).rejects.toThrow("redirect:/signin?next=%2F&auth_error=google_not_configured");
  });

  test("the button posts the intent and where to go next", () => {
    const html = renderToStaticMarkup(createElement(GoogleButton, { intent: "signup", next: "/ng" }));
    expect(html).toContain("Sign up with Google");
    expect(html).toMatch(/name="intent" value="signup"/);
    expect(html).toMatch(/name="next" value="\/ng"/);
  });
});

describe("Google returning to udozo.com", () => {
  const flow = JSON.stringify({ state: "st_abcdefghijklmnopqrstuvwxyz", intent: "signup", next: "/sell", ref: "abc123def0" });

  test("the same state signs the new account in and sends it to onboarding first", async () => {
    setRequest({ host: "udozo.com" }, { udz_google: flow });
    reply = () => Response.json({ customer: newCustomer, session: { token: "bcc_google" }, signed_up: true });
    const res = await GET(new Request("https://udozo.com/auth/google/callback?state=st_abcdefghijklmnopqrstuvwxyz&code=google-code"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://udozo.com/verify?next=%2Fsell");
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/store/account/google/finish", body: { state: "st_abcdefghijklmnopqrstuvwxyz", code: "google-code", ref: "abc123def0" } });
    expect(request.set.find(item => item.name === "udz_customer")?.value).toBe("bcc_google");
    expect(request.cookies.has("udz_google")).toBe(false);
  });

  test("an account already set up goes straight on", async () => {
    setRequest({ host: "udozo.com" }, { udz_google: flow });
    reply = () => Response.json({ customer: { ...newCustomer, country: "NG", phone_verified: true, phone: "+2348031234567" }, session: { token: "bcc_google" }, signed_up: false });
    const res = await GET(new Request("https://udozo.com/auth/google/callback?state=st_abcdefghijklmnopqrstuvwxyz&code=google-code"));
    expect(res.headers.get("location")).toBe("https://udozo.com/sell");
  });

  test("another state, none, or a refusal goes back to the page saying why, signing nobody in", async () => {
    setRequest({ host: "udozo.com" }, { udz_google: flow });
    const wrong = await GET(new Request("https://udozo.com/auth/google/callback?state=st_someone_elses_state_xxxx&code=google-code"));
    expect(wrong.headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&auth_error=google_state_invalid");
    expect(calls).toHaveLength(0);

    setRequest({ host: "udozo.com" }, { udz_google: flow });
    reply = () => Response.json({ error: { code: "account_exists_sign_in_with_password", message: "x" } }, { status: 409 });
    const taken = await GET(new Request("https://udozo.com/auth/google/callback?state=st_abcdefghijklmnopqrstuvwxyz&code=google-code"));
    expect(taken.headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&auth_error=account_exists_sign_in_with_password");
    expect(request.set.some(item => item.name === "udz_customer")).toBe(false);
  });

  test("onboarding is due until the account has a country and a confirmed mobile", () => {
    expect(confirmationPending(newCustomer)).toBe(true);
    expect(confirmationPending({ ...newCustomer, country: "NG", phone_verification_available: true })).toBe(true);
    expect(confirmationPending({ ...newCustomer, country: "NG", phone_verification_available: true, phone_verified: true })).toBe(false);
  });
});
