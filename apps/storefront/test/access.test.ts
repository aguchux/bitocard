import { afterEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { accessApi } from "@/lib/access";

const token = `bca_${"A".repeat(43)}`;
type Call = [string, RequestInit & { headers: Record<string, string> }];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("accessApi", () => {
  test("never asks the API about something that is not an access link", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const bad of ["", "bca_short", "../v1/orders", `${token}/../x`]) expect((await accessApi(bad)).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("forwards the customer's proof: their store session and this page's pass, never cached", async () => {
    vi.stubEnv("STORE_SERVER_SECRET", "store-server-secret-for-tests-0123456789");
    setRequest({ "x-real-ip": "203.0.113.7" }, { bc_customer: "bcc_session", bc_access: "pass.signature" });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "order_access" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await accessApi(token);
    await accessApi(token, "/reveal");
    await accessApi(token, "/verify", { code: "123456" });
    const [[viewUrl, view], [revealUrl, reveal], [, verify]] = fetch.mock.calls as unknown as Call[];
    expect(viewUrl).toMatch(new RegExp(`/v1/store/access/${token}$`));
    expect([view.method, view.cache]).toEqual(["GET", "no-store"]);
    expect(view.headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(view.headers["bitocard-access-pass"]).toBe("pass.signature");
    expect(view.headers["bitocard-client"]).toContain("ip=203.0.113.7");
    expect([revealUrl.endsWith("/reveal"), reveal.method]).toEqual([true, "POST"]);
    expect(verify.body).toBe(JSON.stringify({ code: "123456" }));
  });

  test("reads VPN access with a GET and asks for a new password with a POST", async () => {
    setRequest({}, { bc_customer: "bcc_session" });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ vpn_subscription: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await accessApi(token, "/vpn")).toEqual({ ok: true, data: { vpn_subscription: null } });
    await accessApi(token, "/vpn/password-reset");
    const [[vpnUrl, vpn], [resetUrl, reset]] = fetch.mock.calls as unknown as Call[];
    expect(vpnUrl).toMatch(new RegExp(`/v1/store/access/${token}/vpn$`));
    expect([vpn.method, vpn.body, vpn.headers["content-type"], vpn.cache]).toEqual(["GET", undefined, undefined, "no-store"]);
    expect(vpn.headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(resetUrl).toMatch(new RegExp(`/v1/store/access/${token}/vpn/password-reset$`));
    expect([reset.method, reset.body]).toEqual(["POST", "{}"]);
  });

  test("sends no proof it does not have", async () => {
    setRequest({});
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await accessApi(token);
    const [[, init]] = fetch.mock.calls as unknown as Call[];
    expect(Object.keys(init.headers).filter(name => name.startsWith("bitocard-"))).toEqual([]);
  });

  test("errors come back as results, never thrown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "access_required", message: "Sign in." } }), { status: 401 })));
    expect(await accessApi(token, "/reveal")).toEqual({ ok: false, status: 401, code: "access_required", message: "Sign in." });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("down"))));
    expect((await accessApi(token)).ok).toBe(false);
  });
});

describe("idempotency", () => {
  test("sends an Idempotency-Key on writes (the form's nonce when given), never on reads", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await accessApi(token, "/vpn");
    await accessApi(token, "/vpn/password-reset");
    await accessApi(token, "/vpn/password-reset", undefined, { idempotencyKey: "attempt-12345678" });
    await accessApi(token, "/vpn/password-reset", undefined, { idempotencyKey: "bad key!" });
    const keys = fetch.mock.calls.map(call => ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)["idempotency-key"]);
    expect(keys[0]).toBeUndefined();
    expect(keys[1]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[2]).toBe("attempt-12345678");
    expect(keys[3]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
