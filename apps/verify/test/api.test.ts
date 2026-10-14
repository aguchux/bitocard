import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { POST as exchange } from "@/app/api/session/route";
import { POST as step } from "@/app/api/case/[step]/route";
import { POST as upload } from "@/app/api/upload/route";
import { currentCase, kycApi, kycCookieOptions } from "@/lib/api";

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const kase = { object: "kyc_case", id: "kyc_1", status: "draft" };
const token = "hand0ff_token-abcdefghijklmnop";
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://verify.test${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({}, { bc_kyc: "bks_session" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the applicant's API calls", () => {
  test("send the session from the cookie, and a fresh Idempotency-Key on every change", async () => {
    const fetch = vi.fn(async () => reply(kase));
    vi.stubGlobal("fetch", fetch);
    expect(await currentCase()).toEqual({ ok: true, data: kase });
    await kycApi("PUT", "/v1/kyc/case/consent", { consent: true });
    await kycApi("POST", "/v1/kyc/case/submit", {});
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], call[1].method])).toEqual([
      ["http://api.test/v1/kyc/case", "GET"],
      ["http://api.test/v1/kyc/case/consent", "PUT"],
      ["http://api.test/v1/kyc/case/submit", "POST"],
    ]);
    for (const call of calls) expect(call[1].headers["bitocard-kyc-session"]).toBe("bks_session");
    expect(calls[0][1].headers["idempotency-key"]).toBeUndefined();
    const keys = calls.slice(1).map(call => call[1].headers["idempotency-key"]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ consent: true });
  });

  test("never throw: no session, the API's error, or no connection", async () => {
    setRequest({}, {});
    const fetch = vi.fn(async () => reply({ error: { code: "case_locked", message: "Already sent.", param: null } }, 409));
    vi.stubGlobal("fetch", fetch);
    expect(await currentCase()).toMatchObject({ ok: false, status: 401, code: "kyc_session_missing" });
    expect(fetch).not.toHaveBeenCalled();
    setRequest({}, { bc_kyc: "bks_session" });
    expect(await kycApi("POST", "/v1/kyc/case/submit", {})).toEqual({ ok: false, status: 409, code: "case_locked", message: "Already sent.", param: null });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect(await currentCase()).toMatchObject({ ok: false, status: 0 });
  });
});

describe("POST /api/session", () => {
  test("exchanges the link's token and keeps the session in a host-only, httpOnly, Strict cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetch = vi.fn(async () => reply({ object: "kyc_session", session: { token: "bks_new", expires_at: "2026-10-14T12:00:00Z" }, case: kase }));
    vi.stubGlobal("fetch", fetch);
    const res = await exchange(post("/api/session", { token }, { "sec-fetch-site": "same-origin" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "draft" });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^bc_kyc=bks_new;/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).toMatch(/Max-Age=7200/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/i);
    const [call] = fetch.mock.calls as unknown as Call[];
    expect(call[0]).toBe("http://api.test/v1/kyc/session");
    expect(call[1].headers["bitocard-kyc-session"]).toBeUndefined();
    expect(JSON.parse(String(call[1].body))).toEqual({ token });
    expect(kycCookieOptions()).toMatchObject({ httpOnly: true, secure: true, sameSite: "strict" });
  });

  test("a bad, used or expired link sets no cookie; malformed tokens never reach the API", async () => {
    const fetch = vi.fn(async () => reply({ error: { code: "kyc_link_invalid", message: "Expired." } }, 404));
    vi.stubGlobal("fetch", fetch);
    const res = await exchange(post("/api/session", { token }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("kyc_link_invalid");
    expect(res.headers.get("set-cookie")).toBeNull();
    for (const bad of [{}, { token: "short" }, { token: "a b c d e f g h i j k l m n o p" }, { token: 42 }]) {
      expect((await exchange(post("/api/session", bad))).status).toBe(404);
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("other sites cannot call it; an unreachable API is a 502, not an expired link", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    expect((await exchange(post("/api/session", { token }, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await exchange(post("/api/session", { token }))).status).toBe(502);
  });
});

describe("the wizard's steps and uploads", () => {
  test("each step goes to its own endpoint; unknown steps and non-JSON are refused", async () => {
    const fetch = vi.fn(async () => reply(kase));
    vi.stubGlobal("fetch", fetch);
    const params = (value: string) => ({ params: Promise.resolve({ step: value }) });
    expect((await step(post("/api/case/identity", { id_type: "nin" }), params("identity"))).status).toBe(200);
    expect((await step(post("/api/case/liveness", {}), params("liveness"))).status).toBe(200);
    expect((await step(post("/api/case/approve", {}), params("approve"))).status).toBe(404);
    const plain = new Request("http://verify.test/api/case/submit", { method: "POST", body: "x" });
    expect((await step(plain, params("submit"))).status).toBe(415);
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => [call[0], call[1].method])).toEqual([
      ["http://api.test/v1/kyc/case/identity", "PUT"],
      ["http://api.test/v1/kyc/case/liveness", "POST"],
    ]);
  });

  test("uploads are checked here, then passed on as multipart with the session", async () => {
    const fetch = vi.fn(async () => reply(kase));
    vi.stubGlobal("fetch", fetch);
    const send = (kind: string, file: Blob, name = "x") => {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file, name);
      return upload(new Request("http://verify.test/api/upload", { method: "POST", body: form }));
    };
    const jpeg = new Blob([new Uint8Array(2048)], { type: "image/jpeg" });
    const pdf = new Blob([new Uint8Array(2048)], { type: "application/pdf" });
    expect((await send("id_front", jpeg, "front.jpg")).status).toBe(200);
    expect((await send("business_directors", pdf, "directors.pdf")).status).toBe(200);
    expect((await send("id_front", pdf)).status).toBe(400);
    expect((await send("liveness_0_0", new Blob([new Uint8Array(10)], { type: "image/png" }))).status).toBe(400);
    expect((await send("passport_scan", jpeg)).status).toBe(400);
    expect((await send("selfie", new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: "image/jpeg" }))).status).toBe(413);
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe("http://api.test/v1/kyc/case/documents");
    expect(calls[0][1].headers["bitocard-kyc-session"]).toBe("bks_session");
    expect(calls[0][1].headers["content-type"]).toBeUndefined();
    const form = calls[0][1].body as FormData;
    expect(form.get("kind")).toBe("id_front");
    expect((form.get("file") as File).name).toBe("front.jpg");
  });
});
