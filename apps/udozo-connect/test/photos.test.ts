// Office photos go through this site's own server: only its own pages may send one; the server asks Udozo for a
// signed upload, PUTs the bytes to storage with exactly the link's headers, then attaches the photo.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";
import { sessionCookie } from "@/lib/session";

const { POST } = await import("@/app/api/applications/[id]/photos/route");

const id = "0b7f1c52-3a3c-4f7e-9c58-2b9b3c8d1e01";
const params = { params: Promise.resolve({ id }) };
const calls: Array<{ method: string; url: string; headers: Record<string, string>; body: unknown }> = [];

function photoRequest(headers: Record<string, string> = { "sec-fetch-site": "same-origin" }, kind = "shopfront") {
  const form = new FormData();
  form.set("kind", kind);
  form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "front.jpg", { type: "image/jpeg" }));
  return new Request(`https://connect.udozo.test/api/applications/${id}/photos`, { method: "POST", headers, body: form });
}

beforeEach(() => {
  calls.length = 0;
  setRequest({}, { [sessionCookie]: "bcc_token" });
  vi.stubEnv("API_URL", "https://api.udozo.test");
  vi.stubEnv("CONNECT_URL", "https://connect.udozo.test");
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method: String(init.method), url, headers, body: typeof init.body === "string" ? JSON.parse(init.body) : init.body });
    if (url.endsWith("/photos/uploads")) return Response.json({ id: "media-1", upload: { method: "PUT", url: "https://spaces.test/staging/media-1.jpg", headers: { "content-type": "image/jpeg", "x-amz-acl": "private" } } });
    if (url.startsWith("https://spaces.test/")) return new Response(null, { status: 200 });
    return Response.json({ object: "connect_application", id, photos: [{ id: "p1", url: "https://media.test/front.jpg", kind: "shopfront" }] });
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("sending an office photo", () => {
  it("is refused from another site", async () => {
    expect((await POST(photoRequest({ "sec-fetch-site": "cross-site" }), params)).status).toBe(403);
    expect((await POST(photoRequest({ "sec-fetch-site": "same-site" }), params)).status).toBe(403);
    expect((await POST(photoRequest({ origin: "https://evil.example" }), params)).status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("asks for the signed link, PUTs the bytes with exactly its headers, then attaches the photo", async () => {
    const res = await POST(photoRequest(), params);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { application: { photos: unknown[] } }).application.photos).toHaveLength(1);
    expect(calls.map(call => `${call.method} ${call.url}`)).toEqual([
      `POST https://api.udozo.test/v1/connect/applications/${id}/photos/uploads`,
      "PUT https://spaces.test/staging/media-1.jpg",
      `POST https://api.udozo.test/v1/connect/applications/${id}/photos`,
    ]);
    expect(calls[0]!.body).toEqual({ filename: "front.jpg", content_type: "image/jpeg", size: 7 });
    expect(calls[0]!.headers["bitocard-customer-session"]).toBe("bcc_token");
    expect(calls[1]!.headers).toEqual({ "content-type": "image/jpeg", "x-amz-acl": "private" });
    expect(Buffer.from(calls[1]!.body as Buffer)).toHaveLength(7);
    expect(calls[2]!.body).toEqual({ media_id: "media-1", kind: "shopfront" });
  });

  it("refuses an unknown kind, a non-photo and an unknown application", async () => {
    expect((await POST(photoRequest(undefined, "selfie"), params)).status).toBe(400);
    const form = new FormData();
    form.set("kind", "counter");
    form.set("file", new File(["%PDF"], "a.pdf", { type: "application/pdf" }));
    expect((await POST(new Request("https://connect.udozo.test/x", { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: form }), params)).status).toBe(400);
    expect((await POST(photoRequest(), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("says when storage refuses the upload and attaches nothing", async () => {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url, headers: {}, body: null });
      if (url.endsWith("/photos/uploads")) return Response.json({ id: "media-1", upload: { method: "PUT", url: "https://spaces.test/x", headers: {} } });
      return new Response(null, { status: 403 });
    });
    const res = await POST(photoRequest(), params);
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(2);
  });
});
