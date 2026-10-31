// Invite links from Udozo's Marketing (udozo.com/i/<code>) and the referral code sign-up carries: the link tells the API
// it was opened and opens sign-up with the code, which the account keeps.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, notFound: () => { throw new Error("not-found"); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { GET } = await import("@/app/i/[code]/route");
const actions = await import("@/lib/account-actions");
const { cleanRef, inviteSignupPath, isInviteCode } = await import("@/lib/invite");

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let reply: () => Response;
const customer = { object: "customer", id: "c1", email: "ada@example.com", name: "Ada Obi", email_verified: true, phone: "+2348031234567", phone_verified: true, phone_verification_available: true, country: "NG", currency: "NGN", created_at: "2026-10-31T00:00:00Z" };

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  setRequest({ host: "udozo.com" });
  calls = [];
  reply = () => new Response(null, { status: 204 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
    return reply();
  });
});

const open = (code: string) => GET(new NextRequest(`https://udozo.com/i/${code}`), { params: Promise.resolve({ code }) });

describe("an invite link", () => {
  test("tells the API it was opened, then opens sign-up with the code, uncached", async () => {
    const response = await open("abc123def0");
    expect(calls).toEqual([{ url: "https://api.test/v1/marketing/invites/abc123def0/open", method: "POST", body: null }]);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&ref=abc123def0");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("still opens sign-up when the API cannot be reached; a malformed code goes to Start here and asks nothing", async () => {
    reply = () => {
      throw new Error("offline");
    };
    expect((await open("abc123def0")).headers.get("location")).toBe("https://udozo.com/signup?next=%2Fsell&ref=abc123def0");
    calls = [];
    expect((await open("NOT-A-CODE")).headers.get("location")).toBe("https://udozo.com/start-here");
    expect(calls).toEqual([]);
  });

  test("codes and refs are checked", () => {
    expect([isInviteCode("abc123def0"), isInviteCode("ABC"), isInviteCode("a/b")]).toEqual([true, false, false]);
    expect([cleanRef("ada-01"), cleanRef(["mk1", "x"]), cleanRef("<script>"), cleanRef(undefined)]).toEqual(["ada-01", "mk1", null, null]);
    expect(inviteSignupPath("abc123def0")).toBe("/signup?next=%2Fsell&ref=abc123def0");
  });
});

describe("sign-up keeps the code", () => {
  test("the account is made with the ref the link carried, and without a malformed one", async () => {
    reply = () => Response.json({ customer, session: { token: "bcc_new" } }, { status: 201 });
    const input = { name: "Ada Obi", email: "ada@example.com", country: "NG", phone: "+2348031234567", password: "a long password", token: "tok_0123456789abcdefghij", next: "/sell" };
    await expect(actions.finishSignUp({ ...input, ref: "abc123def0" })).rejects.toThrow("redirect:/sell");
    expect(calls.at(-1)!.body).toMatchObject({ ref: "abc123def0" });
    await expect(actions.finishSignUp({ ...input, ref: "not a code!" })).rejects.toThrow("redirect:/sell");
    expect(calls.at(-1)!.body).not.toHaveProperty("ref");
  });
});
