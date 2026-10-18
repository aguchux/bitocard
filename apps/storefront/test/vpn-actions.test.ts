import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh: () => refresh() }));

const { resetVpnPassword } = await import("@/lib/vpn-actions");

type Call = [string, RequestInit & { headers: Record<string, string> }];
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const checkout = "0b7c2a1e-4d5f-4a6b-8c9d-0e1f2a3b4c5d";
const token = `bca_${"a".repeat(43)}`;
const reset = { vpn_subscription: { object: "vpn_subscription", id: "v1", status: "active" }, credentials: { username: "bc-ref", password: "new-password-123" } };

beforeEach(() => {
  vi.stubEnv("API_URL", "http://api.test");
  setRequest({ host: "bitocard.com" }, { bc_customer: "bcc_session" });
  refresh.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("VPN password reset", () => {
  test("signed in: posts to the customer's own checkout and returns the new sign-in once", async () => {
    const fetch = vi.fn(async () => reply(reset));
    vi.stubGlobal("fetch", fetch);
    expect(await resetVpnPassword({ checkout })).toEqual({ ok: true, username: "bc-ref", password: "new-password-123" });
    const [call] = fetch.mock.calls as unknown as Call[];
    expect([call[0], call[1].method]).toEqual([`http://api.test/v1/store/checkouts/${checkout}/vpn/password-reset`, "POST"]);
    expect(call[1].headers["bitocard-customer-session"]).toBe("bcc_session");
    expect(refresh).toHaveBeenCalled();
  });

  test("on an order link: posts with the customer's proof; an ended pass asks them to confirm again", async () => {
    const fetch = vi.fn(async () => reply(reset));
    vi.stubGlobal("fetch", fetch);
    expect((await resetVpnPassword({ token })).ok).toBe(true);
    const [call] = fetch.mock.calls as unknown as Call[];
    expect([call[0], call[1].method]).toEqual([`http://api.test/v1/store/access/${token}/vpn/password-reset`, "POST"]);

    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "authentication_error", code: "access_required", message: "Prove it", request_id: "r" } }, 401)));
    expect(await resetVpnPassword({ token })).toEqual({ ok: false, error: "Your access has ended. Reload the page to confirm it is you again." });
  });

  test("an unclear reset says to try again; nonsense is refused, never sent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply({ error: { type: "api_error", code: "vpn_password_reset_pending", message: "The new password is not confirmed yet. Try again in a minute: the same reset continues.", request_id: "r" } }, 503)));
    expect(await resetVpnPassword({ checkout })).toEqual({ ok: false, error: "The new password is not confirmed yet. Try again in a minute: the same reset continues." });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await resetVpnPassword({ checkout: "not-an-id" })).toEqual({ ok: false, error: "This order was not found." });
    expect(await resetVpnPassword({ token: "bca_short" })).toEqual({ ok: false, error: "This link is not valid." });
    expect(fetch).not.toHaveBeenCalled();
  });
});
