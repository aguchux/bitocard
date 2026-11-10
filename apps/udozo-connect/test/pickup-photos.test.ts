// A pickup's check-out photos, sent and read by a centre's people through this site's own server (never the browser to
// the API).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";

const { POST } = await import("@/app/api/centres/[id]/pickups/[pickup]/photos/route");
const { GET } = await import("@/app/api/centres/[id]/pickups/[pickup]/photos/[photo]/route");

const id = "11111111-1111-4111-8111-111111111111";
let answer: () => Response;
const asked: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];

const send = (file: Blob | null, headers: Record<string, string> = {}, params = { id, pickup: id }) => {
  const body = new FormData();
  if (file) body.append("file", file, "photo.jpg");
  return POST(new Request("https://connect.udozo.test/api", { method: "POST", body, headers }), { params: Promise.resolve(params) });
};

beforeEach(() => {
  asked.length = 0;
  setRequest({}, { udz_connect: "bcc_session" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  answer = () => Response.json({ object: "connect_pickup", id, photos: [{ id }] }, { status: 201 });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    asked.push({ url, method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: init.body });
    return answer();
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sending a check-out photo", () => {
  it("passes the photo on as multipart with the session, and answers the pickup", async () => {
    const res = await send(new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { pickup: { photos: unknown[] } }).pickup.photos).toHaveLength(1);
    expect(asked[0]).toMatchObject({ url: `https://api.udozo.test/v1/connect/centres/${id}/pickups/${id}/photos`, method: "POST", headers: { "bitocard-customer-session": "bcc_session" } });
    expect(asked[0].body).toBeInstanceOf(FormData);
  });

  it("refuses another site, other files and made-up ids without asking; passes on Udozo's refusal", async () => {
    expect((await send(new Blob(["x"], { type: "image/jpeg" }), { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await send(new Blob(["x"], { type: "application/pdf" }))).status).toBe(400);
    expect((await send(null)).status).toBe(400);
    expect((await send(new Blob(["x"], { type: "image/jpeg" }), {}, { id: "../x", pickup: id })).status).toBe(404);
    expect(asked).toHaveLength(0);
    answer = () => Response.json({ error: { code: "pickup_not_scheduled", message: "Photos are added before the hand-over." } }, { status: 409 });
    const refused = await send(new Blob([new Uint8Array([0xff, 0xd8])], { type: "image/jpeg" }));
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toBe("Photos are added before the hand-over.");
  });
});

describe("reading a check-out photo", () => {
  it("passes on images only, never cached, and wants a session", async () => {
    answer = () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { headers: { "content-type": "image/jpeg" } });
    const res = await GET(new Request("https://connect.udozo.test/api"), { params: Promise.resolve({ id, pickup: id, photo: id }) });
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "private, no-store"]);
    expect(asked[0].url).toBe(`https://api.udozo.test/v1/connect/centres/${id}/pickups/${id}/photos/${id}`);
    answer = () => new Response("<html>", { headers: { "content-type": "text/html" } });
    expect((await GET(new Request("https://connect.udozo.test/api"), { params: Promise.resolve({ id, pickup: id, photo: id }) })).status).toBe(404);
    setRequest({}, {});
    expect((await GET(new Request("https://connect.udozo.test/api"), { params: Promise.resolve({ id, pickup: id, photo: id }) })).status).toBe(401);
  });
});
