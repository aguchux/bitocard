// "Continue with Facebook" on udozo.com (8 November 2026), as Google's: the start keeps the API's one-time state in this
// site's own `udz_facebook` cookie and sends the browser to Facebook; the callback finishes only with that same state,
// keeps the session, and sends a new account (its email still to confirm with Udozo's code) on to /verify.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => redirect("not-found") }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { continueWithFacebook } = await import("@/lib/facebook-actions");
const { GET } = await import("@/app/auth/facebook/callback/route");
const { FacebookButton } = await import("@/components/account/facebook-button");
const { authErrorText } = await import("@/lib/facebook");

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let reply: (url: string) => Response;
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const state = "st_facebookfacebookfacebook";
const newCustomer = { object: "customer", id: "c9", email: "chiamaka@example.com", name: "Chiamaka Eze", first_name: "Chiamaka", last_name: "Eze", name_confirmed: false, email_verified: false, phone: null, phone_verified: false, phone_verification_available: false, country: null, currency: null, created_at: "2026-11-08T00:00:00Z" };

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" });
  redirect.mockClear();
  calls = [];
  reply = () => Response.json({ object: "facebook_sign_in", url: `https://www.facebook.com/v23.0/dialog/oauth?client_id=1&state=${state}`, state });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("starting with Facebook", () => {
  test("asks the API, keeps the state (with the intent, next and an invite's ref) in udz_facebook, and goes to Facebook", async () => {
    await expect(continueWithFacebook(form({ intent: "signup", next: "/sell", ref: "abc123def0" }))).rejects.toThrow(`redirect:https://www.facebook.com/v23.0/dialog/oauth?client_id=1&state=${state}`);
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/store/account/facebook/start", method: "POST", body: { intent: "signup" } });
    const cookie = request.set.find(item => item.name === "udz_facebook")!;
    expect(JSON.parse(cookie.value)).toEqual({ state, intent: "signup", next: "/sell", ref: "abc123def0" });
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 600 });
  });

  test("not set up yet returns to the page with its code, worded as Facebook's", async () => {
    reply = () => Response.json({ error: { code: "facebook_not_configured", message: "Not yet." } }, { status: 503 });
    await expect(continueWithFacebook(form({ intent: "signin", next: "//evil.example" }))).rejects.toThrow("redirect:/signin?next=%2F&auth_error=facebook_not_configured");
    expect(authErrorText("facebook_not_configured")).toMatch(/Facebook is not available yet/);
    expect(authErrorText("facebook_something_new")).toBe("Facebook sign-in did not work. Try again.");
    expect(authErrorText("google_state_invalid")).toBe("That took too long. Try Google again.");
  });

  test("the sign-in and sign-up pages offer Facebook beside Google, and the button posts the intent", () => {
    const html = renderToStaticMarkup(createElement(FacebookButton, { intent: "signup", next: "/ng" }));
    expect(html).toContain("Sign up with Facebook");
    expect(html).toMatch(/name="intent" value="signup"/);
    for (const page of ["app/(global)/signin/page.tsx", "app/(global)/signup/page.tsx"]) expect(readFileSync(page, "utf8")).toMatch(/<FacebookButton intent="sign(in|up)"/);
    // The cookie notice names the cookie.
    expect(readFileSync("lib/legal.ts", "utf8")).toContain('["udz_facebook", "udozo.com"');
  });
});

describe("Facebook returning to udozo.com", () => {
  const flow = JSON.stringify({ state, intent: "signup", next: "/sell", ref: "abc123def0" });

  test("the same state signs the new account in and sends it to confirm its email first", async () => {
    setRequest({ host: "udozo.com" }, { udz_facebook: flow });
    reply = () => Response.json({ customer: newCustomer, session: { token: "bcc_facebook" }, signed_up: true });
    const res = await GET(new Request(`https://udozo.com/auth/facebook/callback?state=${state}&code=facebook-code`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://udozo.com/verify?next=%2Fsell");
    expect(calls[0]).toMatchObject({ url: "https://api.test/v1/store/account/facebook/finish", body: { state, code: "facebook-code", ref: "abc123def0" } });
    expect(request.set.find(item => item.name === "udz_customer")?.value).toBe("bcc_facebook");
    expect(request.cookies.has("udz_facebook")).toBe(false);
  });

  test("another state, a cancelled consent or a refusal goes back saying why, signing nobody in", async () => {
    setRequest({ host: "udozo.com" }, { udz_facebook: flow });
    const wrong = await GET(new Request("https://udozo.com/auth/facebook/callback?state=st_someone_elses_state_xxxx&code=facebook-code"));
    expect(wrong.headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&auth_error=facebook_state_invalid");
    expect(calls).toHaveLength(0);

    setRequest({ host: "udozo.com" }, { udz_facebook: flow });
    const cancelled = await GET(new Request(`https://udozo.com/auth/facebook/callback?state=${state}&error=access_denied`));
    expect(cancelled.headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&auth_error=facebook_cancelled");

    setRequest({ host: "udozo.com" }, { udz_facebook: flow });
    reply = () => Response.json({ error: { code: "account_exists_sign_in_with_password", message: "x" } }, { status: 409 });
    const taken = await GET(new Request(`https://udozo.com/auth/facebook/callback?state=${state}&code=facebook-code`));
    expect(taken.headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&auth_error=facebook_account_exists");
    expect(authErrorText("facebook_account_exists")).toMatch(/password or Google/);
    expect(request.set.some(item => item.name === "udz_customer")).toBe(false);
  });
});
