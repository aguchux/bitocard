import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { setRequest } from "./request";

// Afrippa's deployment of Verify (verify.afrippa.com): the brand is fixed at build time by NEXT_PUBLIC_VERIFY_BRAND, so
// every module is loaded afresh with it set.
type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const kase = { object: "kyc_case", id: "kyc_1", status: "draft" };
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://verify.test${url}`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: JSON.stringify(body) });

let api: typeof import("@/lib/api");
let brand: typeof import("@/lib/brand");
let hint: typeof import("@/lib/return-hint");

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_VERIFY_BRAND", "afrippa");
  vi.stubEnv("API_URL", "http://api.test");
  vi.resetModules();
  api = await import("@/lib/api");
  brand = await import("@/lib/brand");
  hint = await import("@/lib/return-hint");
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Verify in Afrippa's name", () => {
  test("its own name, session cookie and API routes, never BitoCard's", async () => {
    expect(brand.brand).toMatchObject({ key: "afrippa", name: "Afrippa", product: "Afrippa Verify", cookie: "afr_kyc", apiPrefix: "/v1/afrippa/kyc", review: false });
    expect(api.kycCookie).toBe("afr_kyc");
    const fetch = vi.fn(async () => reply(kase));
    vi.stubGlobal("fetch", fetch);
    setRequest({}, { bc_kyc: "bks_bitocard" });
    expect(await api.currentCase()).toMatchObject({ ok: false, code: "kyc_session_missing" });
    expect(fetch).not.toHaveBeenCalled();
    setRequest({}, { afr_kyc: "bks_afrippa" });
    expect(await api.currentCase()).toEqual({ ok: true, data: kase });
    const { POST: step } = await import("@/app/api/case/[step]/route");
    expect((await step(post("/api/case/consent", { consent: true }), { params: Promise.resolve({ step: "consent" }) })).status).toBe(200);
    const calls = fetch.mock.calls as unknown as Call[];
    expect(calls.map(call => call[0])).toEqual(["http://api.test/v1/afrippa/kyc/case", "http://api.test/v1/afrippa/kyc/case/consent"]);
    expect(calls[0][1].headers["bitocard-kyc-session"]).toBe("bks_afrippa");
  });

  test("the link is exchanged on Afrippa's route and kept in Afrippa's cookie", async () => {
    const fetch = vi.fn(async () => reply({ object: "kyc_session", session: { token: "bks_new", expires_at: "2026-10-28T12:00:00Z" }, case: kase }));
    vi.stubGlobal("fetch", fetch);
    const { POST: exchange } = await import("@/app/api/session/route");
    const res = await exchange(post("/api/session", { token: "bkh_abcdefghijklmnopqrstuvwxyz" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/^afr_kyc=bks_new;/);
    expect((fetch.mock.calls as unknown as Call[])[0][0]).toBe("http://api.test/v1/afrippa/kyc/session");
  });

  test("a lost applicant is sent back only to afrippa.com, named Afrippa", () => {
    expect(hint.returnHint("https://afrippa.com/verification")).toEqual({ name: "Afrippa", url: "https://afrippa.com/" });
    for (const bad of ["https://bitocard.com/account", "https://shq.bitocard.com/", "https://verify.afrippa.com/s", "http://afrippa.com/", "https://afrippa.com.evil.com/"]) expect(hint.returnHint(bad)).toBeNull();
  });

  test("Afrippa's header and footer, and no review console (Afrippa's admins review its checks)", async () => {
    const { VerifyFooter, VerifyHeader } = await import("@/components/header");
    const header = renderToStaticMarkup(<VerifyHeader brand={{ name: "Afrippa", logo_url: null }} />);
    expect(header).toContain('aria-label="Afrippa Verify"');
    expect(header).toContain("/afrippa/afrippa-mark.png");
    expect(header).not.toContain("Verifying for");
    expect(renderToStaticMarkup(<VerifyFooter />)).toContain("Afrippa Verify · A Golojan Ltd venture");
    const { default: ReviewLayout } = await import("@/app/review/layout");
    expect(() => ReviewLayout({ children: null })).toThrow();
    // Loading the components cold can pass Vitest's 5 seconds while other workspaces' tests run alongside.
  }, 20000);

  test("its icons are served from public/afrippa at the usual addresses", async () => {
    const { default: config } = await import("@/next.config");
    const rewrites = (await config.rewrites!()) as { beforeFiles: Array<{ source: string; destination: string }> };
    expect(rewrites.beforeFiles).toContainEqual({ source: "/favicon.ico", destination: "/afrippa/favicon.ico" });
    expect(rewrites.beforeFiles).toContainEqual({ source: "/icon-192.png", destination: "/afrippa/icon-192.png" });
  });
});
