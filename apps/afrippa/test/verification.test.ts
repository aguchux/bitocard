import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const redirect = vi.fn((url: string) => {
  throw new Error(`redirect:${url}`);
});
const revalidatePath = vi.fn();
vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), redirect: (url: string) => redirect(url), useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: (path: string, type?: string) => revalidatePath(path, type), unstable_cache: (fn: () => unknown) => fn }));

const actions = await import("@/lib/verification");
const { checkText } = await import("@/lib/verification-types");
const { default: VerificationPage } = await import("@/app/verification/page");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = vi.fn();
type Call = [string, RequestInit & { headers: Record<string, string> }];
const calls = () => fetchMock.mock.calls as unknown as Call[];
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};
const twoStep = { object: "two_step_state", pending: false, setup_required: false, method: "email", method_not_allowed: false };
const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, country: "NG", currency: "NGN", created_at: "2026-10-01T00:00:00.000Z", two_step: twoStep };
const check = (status: string, url: string | null = null) => ({ object: "customer_verification", id: "v1", status, url, reason: status === "declined" ? "not_verified" : null, created_at: "2026-10-28T00:00:00.000Z" });

function answer(routes: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
    const key = `${init.method ?? "GET"} ${url.replace("http://api.test", "")}`;
    const found = routes[key];
    if (found instanceof Response) return found;
    return found === undefined ? json({ error: { code: "resource_missing", message: "Not found." } }, 404) : json(found);
  });
}

async function render(element: Promise<React.ReactElement> | React.ReactElement) {
  const stream = await renderToReadableStream(await element);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

beforeEach(() => {
  fetchMock.mockReset();
  redirect.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
  setRequest({ "x-real-ip": "203.0.113.7" }, { afr_session: "bcc_token" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the trader's identity check", () => {
  test("starting needs consent, then goes to Verify in Afrippa's name; only Verify's own address is followed", async () => {
    expect(await actions.startCheck({}, form({}))).toMatchObject({ field: "consent" });
    expect(fetchMock).not.toHaveBeenCalled();

    answer({ "POST /v1/afrippa/account/verification": check("in_progress", "https://verify.afrippa.com/s#t=bkh_token") });
    await expect(actions.startCheck({}, form({ consent: "on" }))).rejects.toThrow("redirect:https://verify.afrippa.com/s#t=bkh_token");
    expect(JSON.parse(String(calls()[0][1].body))).toEqual({ consent: true });
    expect(calls()[0][1].headers["afrippa-signature"]).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);

    // A link anywhere else is never followed.
    for (const url of ["https://evil.example/s#t=x", "http://verify.afrippa.com/s#t=x", "javascript:alert(1)"]) expect(await actions.verifyLink(url)).toBeNull();
    answer({ "POST /v1/afrippa/account/verification": check("in_progress", "https://evil.example/s#t=x") });
    expect(await actions.startCheck({}, form({ consent: "on" }))).toEqual({ notice: "Your check has started." });
  });

  test("the sandbox finishes it with an outcome; a lost session signs in again", async () => {
    answer({ "POST /v1/afrippa/account/verification/simulate": check("approved") });
    expect(await actions.simulateCheck({}, form({ outcome: "approved" }))).toEqual({ notice: "Approved (sandbox)." });
    answer({ "POST /v1/afrippa/account/verification": json({ error: { code: "kyc", message: "Sign in." } }, 401) });
    await expect(actions.startCheck({}, form({ consent: "on" }))).rejects.toThrow("redirect:/signin");
  });

  test("where it stands, worded for the trader (never a reason code)", () => {
    const base = { object: "trader_verification" as const, mode: "live" as const };
    expect(checkText({ ...base, verified: true, latest: null }).action).toBeNull();
    expect(checkText({ ...base, verified: false, latest: null }).action).toBe("start");
    expect(checkText({ ...base, verified: false, latest: check("in_review") as never }).title).toBe("Your check is with our team");
    const declined = checkText({ ...base, verified: false, latest: check("declined") as never });
    expect([declined.action, declined.body.includes("not_verified")]).toEqual(["again", false]);
  });

  test("the page: the consent form live, the simulate buttons in the sandbox", async () => {
    answer({ "GET /v1/afrippa/account": customer, "GET /v1/afrippa/account/verification": { object: "trader_verification", mode: "live", verified: false, latest: null } });
    const live = await render(VerificationPage());
    expect(live).toContain("Start my check");
    expect(live).toContain("biometric data");
    expect(live).not.toContain("Approve");

    answer({ "GET /v1/afrippa/account": customer, "GET /v1/afrippa/account/verification": { object: "trader_verification", mode: "test", verified: false, latest: check("in_progress") } });
    const sandbox = await render(VerificationPage());
    expect(sandbox).toContain("Approve");
    expect(sandbox).not.toContain("Carry on with my check");
  });
});
