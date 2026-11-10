// The seller's dispatch photos, read by a centre's people through this site's own server (never the browser to the API).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

const { GET } = await import("@/app/api/centres/[id]/orders/[order]/photos/[photo]/route");

const id = "11111111-1111-4111-8111-111111111111";
const ask = (params: { id: string; order: string; photo: string }) => GET(new Request("https://connect.udozo.test/api"), { params: Promise.resolve(params) });
let answer: () => Response;
const asked: Array<{ url: string; headers: Record<string, string> }> = [];

beforeEach(() => {
  asked.length = 0;
  setRequest({}, { udz_connect: "bcc_session" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  answer = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    asked.push({ url, headers: init.headers as Record<string, string> });
    return answer();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a centre's view of the seller's photos", () => {
  it("asks the centre's own route with the session, and is never cached", async () => {
    const res = await ask({ id, order: id, photo: id });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(asked[0]).toMatchObject({ url: `https://api.udozo.test/v1/connect/centres/${id}/orders/${id}/dispatch-photos/${id}`, headers: { "bitocard-customer-session": "bcc_session" } });
  });

  it("passes on images only, refuses made-up ids without asking, and wants a session", async () => {
    answer = () => Response.json({ error: { code: "resource_missing" } }, { status: 404 });
    expect((await ask({ id, order: id, photo: id })).status).toBe(404);
    answer = () => new Response("<html>", { headers: { "content-type": "text/html" } });
    expect((await ask({ id, order: id, photo: id })).status).toBe(404);
    asked.length = 0;
    expect((await ask({ id: "../admin", order: id, photo: id })).status).toBe(404);
    expect(asked).toHaveLength(0);
    setRequest({}, {});
    expect((await ask({ id, order: id, photo: id })).status).toBe(401);
  });
});
