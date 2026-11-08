// Signing up and in with WhatsApp on udozo.com (8 November 2026, the owner's request): the start keeps the API's token
// in this site's own `udz_whatsapp` cookie and opens the waiting page; the page asks `/api/whatsapp-sign-in` until
// WhatsApp approved it, then this browser is signed in. And the green WhatsApp tab hanging under the header.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { request, setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url), notFound: () => redirect("not-found"), usePathname: () => "/ng/c/phones", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/account-actions", () => ({ signOut: async () => undefined }));

const { continueWithWhatsapp } = await import("@/lib/whatsapp-sign-in-actions");
const { POST } = await import("@/app/api/whatsapp-sign-in/route");
const { waitingState } = await import("@/components/account/whatsapp-waiting");
const { authErrorText } = await import("@/lib/facebook");
const { HeaderBar } = await import("@/components/header");

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let whatsappOpen: boolean;
let finish: () => Response;
const token = "bws_abcdefghijklmnopqrstuvwxyz0123";
const flow = (next = "/sell") => JSON.stringify({ token, code: "ABCD2345", text: "JOIN ABCD2345", link: "https://wa.me/2348000000000?text=JOIN%20ABCD2345", intent: "signup", next, expires: "2026-11-08T10:20:00Z" });
const customer = { object: "customer", id: "c9", email: "ada@example.com", name: "Ada Obi", first_name: "Ada", last_name: "Obi", name_confirmed: true, email_verified: true, phone: "+2348031234567", phone_verified: true, phone_verification_available: true, country: "NG", currency: "NGN", created_at: "2026-11-08T00:00:00Z" };

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ host: "udozo.com" });
  redirect.mockClear();
  calls = [];
  whatsappOpen = true;
  finish = () => Response.json({ object: "whatsapp_sign_in_status", status: "waiting" });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    if (url.includes("/v1/classifieds/markets")) return Response.json({ object: "list", data: [{ country: "NG", name: "Nigeria", listings: 3 }], showcase: false });
    if (url.includes("/v1/classifieds/channels")) return Response.json({ object: "classified_channels", country: "NG", whatsapp: { available: whatsappOpen, number: whatsappOpen ? "+2348000000000" : null }, wanted: true });
    if (url.endsWith("/whatsapp-sign-in/start")) return Response.json({ object: "whatsapp_sign_in", intent: "signup", code: "ABCD2345", text: "JOIN ABCD2345", link: "https://wa.me/2348000000000?text=JOIN%20ABCD2345", token, expires_at: "2026-11-08T10:20:00Z" });
    if (url.endsWith("/whatsapp-sign-in/finish")) return finish();
    return Response.json({});
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

describe("starting with WhatsApp", () => {
  test("asks the API in a market where Udozo is on WhatsApp, keeps the token (never shown to the page) and opens the waiting page", async () => {
    await expect(continueWithWhatsapp(form({ intent: "signup", next: "/sell", ref: "abc123def0" }))).rejects.toThrow("redirect:/signin/whatsapp");
    expect(calls.find(call => call.url.endsWith("/start"))).toMatchObject({ method: "POST", body: { intent: "signup", country: "NG", ref: "abc123def0" } });
    const cookie = request.set.find(item => item.name === "udz_whatsapp")!;
    expect(JSON.parse(cookie.value)).toMatchObject({ token, code: "ABCD2345", text: "JOIN ABCD2345", intent: "signup", next: "/sell" });
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", maxAge: 1200 });
  });

  test("where Udozo is on WhatsApp nowhere, back to the page saying so", async () => {
    whatsappOpen = false;
    await expect(continueWithWhatsapp(form({ intent: "signin", next: "//evil.example" }))).rejects.toThrow("redirect:/signin?next=%2F&auth_error=whatsapp_unavailable");
    expect(authErrorText("whatsapp_unavailable")).toMatch(/not on WhatsApp in your country yet/);
    expect(authErrorText("whatsapp_something")).toBe("Signing in with WhatsApp did not work. Try again.");
  });
});

describe("waiting for WhatsApp", () => {
  test("waits while WhatsApp has not answered, then signs this browser in once and says where to go", async () => {
    setRequest({ host: "udozo.com" }, { udz_whatsapp: flow() });
    expect(await (await POST(new Request("https://udozo.com/api/whatsapp-sign-in", { method: "POST" }))).json()).toEqual({ status: "waiting" });
    expect(request.cookies.has("udz_whatsapp")).toBe(true);
    expect(calls.find(call => call.url.endsWith("/finish"))?.body).toEqual({ token });

    finish = () => Response.json({ object: "whatsapp_sign_in_status", status: "approved", customer, session: { token: "bcc_whatsapp" }, signed_up: true });
    const done = await (await POST(new Request("https://udozo.com/api/whatsapp-sign-in", { method: "POST" }))).json();
    expect(done).toEqual({ status: "approved", redirect: "/sell", signed_up: true });
    expect(request.set.find(item => item.name === "udz_customer")?.value).toBe("bcc_whatsapp");
    expect(request.cookies.has("udz_whatsapp")).toBe(false);
  });

  test("a turned-down sign-in ends the flow; another site cannot ask; the page only goes to this site", async () => {
    setRequest({ host: "udozo.com" }, { udz_whatsapp: flow() });
    finish = () => Response.json({ object: "whatsapp_sign_in_status", status: "declined" });
    expect(await (await POST(new Request("https://udozo.com/api/whatsapp-sign-in", { method: "POST" }))).json()).toEqual({ status: "declined" });
    expect(request.cookies.has("udz_whatsapp")).toBe(false);

    setRequest({ host: "udozo.com" }, { udz_whatsapp: flow() });
    expect((await POST(new Request("https://udozo.com/api/whatsapp-sign-in", { method: "POST", headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);

    expect(waitingState({ status: "approved", redirect: "//evil.example" })).toEqual({ state: "approved", redirect: "/" });
    expect(waitingState({ status: "nonsense" }).state).toBe("over");
  });
});

describe("the WhatsApp tab and buttons", () => {
  const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN" } as never;

  test("hangs under the header where Udozo is on WhatsApp: a chat with Udozo, and signing up or in with WhatsApp", () => {
    const html = renderToStaticMarkup(createElement(HeaderBar, { market, customer: null, showcase: false, categories: [], whatsapp: "+2348000000000" }));
    expect(html).toContain("data-whatsapp-tab");
    expect(html).toContain('href="https://wa.me/2348000000000?text=Hi"');
    expect(html).toContain("Sign up with WhatsApp");
    expect(html).toContain("Sign in with WhatsApp");
    // Back to the page it was opened on.
    expect(html).toMatch(/name="next" value="\/ng\/c\/phones"/);
    const signedIn = renderToStaticMarkup(createElement(HeaderBar, { market, customer: { id: "c1", name: "Ada Obi", email: "a@example.com" } as never, showcase: false, categories: [], whatsapp: "+2348000000000" }));
    expect(signedIn).toContain("Connect your WhatsApp");
    expect(signedIn).not.toContain("Sign up with WhatsApp");
    expect(renderToStaticMarkup(createElement(HeaderBar, { market, customer: null, showcase: false, categories: [] }))).not.toContain("data-whatsapp-tab");
  });

  test("sign-in and sign-up offer it beside Google and Facebook; the cookie notice names its cookie", () => {
    for (const page of ["app/(global)/signin/page.tsx", "app/(global)/signup/page.tsx"]) expect(readFileSync(page, "utf8")).toMatch(/<WhatsappButton intent="sign(in|up)"/);
    expect(readFileSync("lib/legal.ts", "utf8")).toContain('["udz_whatsapp", "udozo.com"');
  });
});
