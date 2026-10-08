import { afterEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { accessApi } from "@/lib/access";
import { sentStatus, smsCode, smsLimit } from "@/app/a/[token]/sms";

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

  test("reads the number with a GET and sends a message with a POST carrying its JSON body", async () => {
    setRequest({}, { bc_customer: "bcc_session" });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "order_number", number: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await accessApi(token, "/number")).toEqual({ ok: true, data: { object: "order_number", number: null } });
    await accessApi(token, "/messages", { to: "+447700900123", text: "Hello" });
    const [[numberUrl, number], [messagesUrl, messages]] = fetch.mock.calls as unknown as Call[];
    expect(numberUrl).toMatch(new RegExp(`/v1/store/access/${token}/number$`));
    expect([number.method, number.body, number.headers["content-type"], number.cache]).toEqual(["GET", undefined, undefined, "no-store"]);
    expect(number.headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(messagesUrl).toMatch(new RegExp(`/v1/store/access/${token}/messages$`));
    expect([messages.method, messages.headers["content-type"]]).toEqual(["POST", "application/json"]);
    expect(messages.body).toBe(JSON.stringify({ to: "+447700900123", text: "Hello" }));
  });

  test("renews and switches automatic renewal with POSTs carrying their JSON bodies", async () => {
    setRequest({}, { bc_access: "pass.signature" });
    const fetch = vi.fn(async () => new Response(JSON.stringify({ object: "order_number", number: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await accessApi(token, "/number/renew");
    await accessApi(token, "/number/auto-renew", { enabled: true });
    const [[renewUrl, renew], [autoUrl, auto]] = fetch.mock.calls as unknown as Call[];
    expect(renewUrl).toMatch(new RegExp(`/v1/store/access/${token}/number/renew$`));
    expect([renew.method, renew.body]).toEqual(["POST", "{}"]);
    expect(renew.headers["bitocard-access-pass"]).toBe("pass.signature");
    expect(autoUrl).toMatch(new RegExp(`/v1/store/access/${token}/number/auto-renew$`));
    expect([auto.method, auto.headers["content-type"], auto.body]).toEqual(["POST", "application/json", JSON.stringify({ enabled: true })]);
  });

  test("passes the API's renewal errors back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "store_cannot_renew", message: "Shop cannot renew this number right now. Contact them." } }), { status: 402 })));
    expect(await accessApi(token, "/number/renew")).toEqual({ ok: false, status: 402, code: "store_cannot_renew", message: "Shop cannot renew this number right now. Contact them." });
  });

  test("passes the API's message errors back", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "sending_not_allowed", message: "Sending is not allowed." } }), { status: 403 })));
    expect(await accessApi(token, "/messages", { to: "+447700900123", text: "Hi" })).toEqual({ ok: false, status: 403, code: "sending_not_allowed", message: "Sending is not allowed." });
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

describe("SMS helpers", () => {
  test("finds the code in an incoming message: the first run of 4 to 8 digits", () => {
    expect(smsCode("Your WhatsApp code is 123-456")).toBe("123456");
    expect(smsCode("Your code: 482 913")).toBe("482913");
    expect(smsCode("Call +44 7700 900123 for help")).toBe(null);
    expect(smsCode("Your code is 482913. Do not share it.")).toBe("482913");
    expect(smsCode("G-1234 is your Google verification code")).toBe("1234");
    expect(smsCode("Code 12345678")).toBe("12345678");
    expect(smsCode("Call +447700900123 about it")).toBe(null);
    expect(smsCode("Use 4821 or 9999")).toBe("4821");
    expect(smsCode("Welcome aboard")).toBe(null);
  });

  test("one part is 160 GSM characters, or 70 when the text needs Unicode", () => {
    expect(smsLimit("")).toBe(160);
    expect(smsLimit("Hello, £5 off: café {now}\nThanks €")).toBe(160);
    expect(smsLimit("Thanks 👍")).toBe(70);
    expect(smsLimit("Привет")).toBe(70);
    expect(smsLimit("“smart quotes”")).toBe(70);
  });

  test("outgoing statuses read in plain words", () => {
    expect(["queued", "sent", "delivered", "failed"].map(status => sentStatus[status])).toEqual(["Sending", "Sent", "Delivered", "Failed"]);
  });
});
