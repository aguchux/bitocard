// Signing in on connect.udozo.com: no passwords here. Sign in goes to udozo.com's handoff; udozo.com sends the browser
// back to `/handoff#c=<code>&n=<next>`, whose page reads and clears the fragment, and this server exchanges the code
// once, naming its own origin, for a session kept in `udz_connect`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request, setRequest } from "./request";

const { continueSignIn } = await import("@/lib/handoff-actions");
const { GET: signIn } = await import("@/app/signin/route");
const { NextRequest } = await import("next/server");

const code = `bch_${"a".repeat(40)}`;
const sent: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];

beforeEach(() => {
  sent.length = 0;
  setRequest({});
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubEnv("CONNECT_URL", "https://connect.udozo.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    return Response.json({ customer: { id: "c1" }, session: { token: "bcc_session" } });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the handoff exchange", () => {
  it("exchanges the code once with this site's own origin and keeps the session", async () => {
    expect(await continueSignIn(code, "/apply")).toEqual({ ok: true, next: "/apply" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://api.udozo.test/v1/store/account/handoff/exchange");
    expect(sent[0]!.body).toEqual({ code, origin: "https://connect.udozo.test" });
    expect(sent[0]!.headers["idempotency-key"]).toBeTruthy();
    expect(request.cookies.get("udz_connect")).toBe("bcc_session");
  });

  it("never follows another site after signing in", async () => {
    expect(await continueSignIn(code, "//evil.example")).toEqual({ ok: true, next: "/" });
  });

  it("refuses a malformed code without asking the API, and says when the API is down", async () => {
    expect(await continueSignIn("nope", "/")).toEqual({ ok: false, unreachable: false });
    expect(sent).toHaveLength(0);
    vi.stubGlobal("fetch", async () => Response.json({ error: { code: "handoff_invalid" } }, { status: 400 }));
    expect(await continueSignIn(code, "/")).toEqual({ ok: false, unreachable: false });
    vi.stubGlobal("fetch", async () => Response.json({}, { status: 503 }));
    expect(await continueSignIn(code, "/")).toEqual({ ok: false, unreachable: true });
    expect(request.cookies.has("udz_connect")).toBe(false);
  });
});

describe("Sign in", () => {
  it("goes to udozo.com's handoff, naming this site and where to land", async () => {
    const res = signIn(new NextRequest("https://connect.udozo.test/signin?next=/application"));
    expect(res.status).toBe(303);
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://udozo.test/handoff/go");
    expect(to.searchParams.get("to")).toBe("https://connect.udozo.test");
    expect(to.searchParams.get("next")).toBe("/application");
  });

  it("lands on Apply when `next` is missing or names another site", async () => {
    for (const next of ["", "https://evil.example", "//evil.example", "/\t/evil.example"]) {
      const res = signIn(new NextRequest(`https://connect.udozo.test/signin?next=${encodeURIComponent(next)}`));
      expect(new URL(res.headers.get("location")!).searchParams.get("next")).toBe("/apply");
    }
  });
});
