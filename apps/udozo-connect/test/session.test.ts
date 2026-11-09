// connect.udozo.com's session: the API's token in this site's own host-only, httpOnly cookie, sent to the API from
// the server only as `BitoCard-Customer-Session`, with the visitor's address signed for rate limits.
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, setRequest } from "./request";

const { clientHeaders, currentCustomer, customerApi, dropSession, keepSession, sessionCookie } = await import("@/lib/session");

const sent: Array<{ url: string; init: RequestInit }> = [];
beforeEach(() => {
  sent.length = 0;
  setRequest({ "x-real-ip": "203.0.113.7" }, { [sessionCookie]: "bcc_token" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Response.json({ object: "customer", id: "c1", name: "Ngozi Eze" });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the session cookie", () => {
  it("is kept host-only, httpOnly, SameSite=Lax for 30 days, and dropped on signing out", async () => {
    await keepSession({ token: "bcc_new" });
    const set = request.set.at(-1)!;
    expect(set).toMatchObject({ name: "udz_connect", value: "bcc_new" });
    expect(set.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    expect(set.options).not.toHaveProperty("domain");
    await dropSession();
    expect(request.cookies.has("udz_connect")).toBe(false);
  });

  it("is Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await keepSession({ token: "bcc_new" });
    expect(request.set.at(-1)!.options).toMatchObject({ secure: true });
  });
});

describe("customerApi", () => {
  it("sends the session header, a fresh Idempotency-Key on POST, and reads JSON", async () => {
    const result = await customerApi("POST", "/v1/connect/applications", { business_name: "Eze Ventures" });
    expect(result.ok).toBe(true);
    const headers = sent[0]!.init.headers as Record<string, string>;
    expect(sent[0]!.url).toBe("https://api.udozo.test/v1/connect/applications");
    expect(headers["bitocard-customer-session"]).toBe("bcc_token");
    expect(headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sent[0]!.init.cache).toBe("no-store");
  });

  it("sends no session when signed out, and no key on GET", async () => {
    setRequest({});
    await customerApi("GET", "/v1/connect/apply");
    const headers = sent[0]!.init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("bitocard-customer-session");
    expect(headers).not.toHaveProperty("idempotency-key");
  });

  it("answers Udozo's refusal in words with its code and param, and an unreachable API as status 0", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "application_incomplete", message: "Still needed: the deposit.", param: "deposit" } }, { status: 400 }));
    expect(await customerApi("POST", "/v1/connect/applications/x/submit", {})).toEqual({ ok: false, status: 400, code: "application_incomplete", message: "Still needed: the deposit.", param: "deposit" });
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await customerApi("GET", "/v1/connect/apply")).toMatchObject({ ok: false, status: 0 });
  });

  it("never runs in a browser", async () => {
    vi.stubGlobal("window", {});
    await expect(customerApi("GET", "/v1/connect/apply")).rejects.toThrow(/server only/);
    expect(sent).toHaveLength(0);
  });

  it("signs the visitor's address with STORE_SERVER_SECRET", async () => {
    vi.stubEnv("STORE_SERVER_SECRET", "s".repeat(40));
    const header = (await clientHeaders(1_700_000_000_000))["bitocard-client"]!;
    const t = 1_700_000_000;
    expect(header).toBe(`t=${t},ip=203.0.113.7,v1=${createHmac("sha256", "s".repeat(40)).update(`${t}.203.0.113.7`).digest("hex")}`);
  });

  it("reads the signed-in customer only with a session", async () => {
    expect(await currentCustomer()).toMatchObject({ id: "c1" });
  });
});
