// Udozo's sign-up journeys, udozo.com's side: the visitor's browser goes with every customer request (so the API can
// say which devices people get stuck on), and opening the sign-up page is counted, once, with nothing about the visitor.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";
import { customerApi } from "@/lib/customer";
import { countSignupVisit } from "@/lib/account-actions";

type Call = { url: string; method: string; headers: Headers; body: unknown };
let calls: Call[];

beforeEach(() => {
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  vi.stubEnv("API_URL", "https://api.test");
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    return Response.json({ object: "notice", message: "Counted." });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("sign-up journeys on udozo.com", () => {
  test("the visitor's browser goes with each step, cut to 500 characters; none is sent when the browser named none", async () => {
    setRequest({ host: "udozo.com", "user-agent": `Mozilla/5.0 (iPhone) ${"x".repeat(600)}` });
    await customerApi("POST", "/v1/store/account/signup/email", { email: "amaka@example.com" });
    const agent = calls[0]!.headers.get("bitocard-client-agent")!;
    expect(agent.startsWith("Mozilla/5.0 (iPhone)")).toBe(true);
    expect(agent).toHaveLength(500);

    setRequest({ host: "udozo.com" });
    await customerApi("POST", "/v1/store/account/signup/email", { email: "amaka@example.com" });
    expect(calls[1]!.headers.get("bitocard-client-agent")).toBeNull();
  });

  test("opening sign-up is counted for udozo.com, with nothing about the visitor", async () => {
    setRequest({ host: "udozo.com" });
    await countSignupVisit();
    expect(calls).toHaveLength(1);
    expect([calls[0]!.method, calls[0]!.url, calls[0]!.body]).toEqual(["POST", "https://api.test/v1/signup-journeys/visits", { surface: "udozo" }]);
  });
});
