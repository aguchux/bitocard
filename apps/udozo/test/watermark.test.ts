// Watermarked listing photos (docs/UDOZO_WATERMARK_PLAN.md): udozo.com's image route reads only `<uuid>.jpg` and the
// three widths, signs its request for the original, draws the store's or Udozo's mark, caches copies for good and
// failures never, and really draws the mark into the photo.
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { storeRoute } from "@/lib/store-host";
import { photoIdOf, photoWidthOf, servePhoto, signMedia, watermarkPhoto } from "@/lib/watermark";
import { config } from "@/proxy";

const id = "0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b";
const secret = "store-server-secret-for-the-image-route-tests";

const realFetch = globalThis.fetch;
const photo = (width = 1200, height = 800) => sharp({ create: { width, height, channels: 3, background: { r: 90, g: 120, b: 150 } } }).jpeg().toBuffer();

describe("addresses", () => {
  test("only a lower-case media ID ending .jpg names a photo", () => {
    expect(photoIdOf(`${id}.jpg`)).toBe(id);
    for (const file of [`${id}.png`, `${id.toUpperCase()}.jpg`, `${id}.jpg.jpg`, `../${id}.jpg`, "photo.jpg", `${id}`, ""]) expect(photoIdOf(file), file).toBeNull();
  });

  test("only 480, 960 and 1600 are widths; anything else is the original's size", () => {
    expect([photoWidthOf("480"), photoWidthOf("960"), photoWidthOf("1600")]).toEqual([480, 960, 1600]);
    for (const raw of [null, "", "500", "4000", "-480", "abc"]) expect(photoWidthOf(raw), String(raw)).toBeNull();
  });

  test("the original is asked for with t and an HMAC of <t>.<id> keyed with the shared secret", () => {
    const now = Date.UTC(2026, 10, 4, 12);
    const header = signMedia(secret, id, now);
    const t = Math.floor(now / 1000);
    expect(header).toBe(`t=${t},v1=${createHmac("sha256", secret).update(`${t}.${id}`).digest("hex")}`);
    expect(header).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });
});

describe("routing", () => {
  test("photos and store paths always go through the proxy, which sends a store's photos to the store's own route", () => {
    expect(config.matcher).toEqual(expect.arrayContaining(["/img/:path*", "/store/:path*"]));
    const store = { subdomain: "gadgets", checkout_mode: "test" as const, domain: null };
    expect(storeRoute({ kind: "subdomain", subdomain: "gadgets" }, store, `/img/${id}.jpg`, "?m=u3s2&w=480")).toEqual({ rewrite: `/store/gadgets/img/${id}.jpg?m=u3s2&w=480` });
    expect(storeRoute({ kind: "domain", domain: "gadgets.ng" }, { ...store, checkout_mode: "live", domain: "gadgets.ng" }, `/img/${id}.jpg`, "?m=u3")).toEqual({ rewrite: `/store/gadgets/img/${id}.jpg?m=u3` });
  });
});

describe("the route", () => {
  let calls: Array<{ url: string; headers: Headers }>;
  let api: { mark: () => Response | Promise<Response>; original: () => Response | Promise<Response> };

  beforeEach(async () => {
    process.env.STORE_SERVER_SECRET = secret;
    process.env.API_URL = "https://api.udozo.test";
    calls = [];
    const original = await photo();
    api = {
      mark: () => Response.json({ object: "watermark", text: "udozo.com", version: "u3" }),
      original: () => new Response(new Uint8Array(original), { headers: { "content-type": "image/jpeg" } }),
    };
    // Only the API is faked: the renderer loads its own files with fetch too.
    vi.stubGlobal("fetch", async (input: string | URL | Request, init: RequestInit = {}) => {
      if (!String(input).startsWith("https://api.udozo.test/")) return realFetch(input, init);
      calls.push({ url: String(input), headers: new Headers(init.headers) });
      return String(input).includes("/original") ? api.original() : api.mark();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.API_URL;
  });

  test("a photo: Udozo's mark, the signed original, a JPEG cached for good", async () => {
    const res = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u3&w=480"), null);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const out = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect([out.format, out.width, out.height]).toEqual(["jpeg", 480, 320]);
    expect(calls[0]!.url).toBe("https://api.udozo.test/v1/classifieds/watermark");
    expect(calls[1]!.url).toBe(`https://api.udozo.test/v1/classifieds/media/${id}/original`);
    expect(calls[1]!.headers.get("udozo-media-signature")).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  }, 60_000);

  test("on a store, the store's mark is asked for by its subdomain", async () => {
    api.mark = () => Response.json({ object: "watermark", text: "gadgets.ng", version: "u3s2" });
    const res = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u3s2"), "gadgets");
    expect(res.status).toBe(200);
    expect(calls[0]!.url).toBe("https://api.udozo.test/v1/classifieds/watermark?store=gadgets");
  }, 60_000);

  test("another mark's version goes to the current one (short cache), keeping the width", async () => {
    const res = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u1&w=960"), null);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`/img/${id}.jpg?m=u3&w=960`);
    expect(calls.some(call => call.url.includes("/original"))).toBe(false);
  });

  test("failures are never cached: a bad address, a missing photo, the API down", async () => {
    const bad = await servePhoto("photo.jpg", new URLSearchParams("m=u3"), null);
    expect([bad.status, bad.headers.get("cache-control")]).toEqual([404, "no-store"]);
    expect(calls).toEqual([]);

    api.original = () => new Response(null, { status: 404 });
    const missing = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u3"), null);
    expect([missing.status, missing.headers.get("cache-control")]).toEqual([404, "no-store"]);

    api.original = () => new Response(null, { status: 500 });
    const broken = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u3"), null);
    expect([broken.status, broken.headers.get("cache-control")]).toEqual([502, "no-store"]);

    api.mark = () => {
      throw new TypeError("fetch failed");
    };
    const down = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u3"), null);
    expect([down.status, down.headers.get("cache-control")]).toEqual([502, "no-store"]);
  });

  test("a store's route answers only the proxy's request naming that store", async () => {
    const { GET } = await import("@/app/store/[store]/img/[file]/route");
    const ask = (headers: Record<string, string>) => GET(new NextRequest(`https://gadgets.udozo.com/store/gadgets/img/${id}.jpg?m=u3`, { headers }), { params: Promise.resolve({ store: "gadgets", file: `${id}.jpg` }) });
    expect((await ask({})).status).toBe(404);
    expect((await ask({ "x-udozo-store": "other" })).status).toBe(404);
    expect(calls).toEqual([]);
    api.mark = () => Response.json({ object: "watermark", text: "gadgets.ng", version: "u3" });
    expect((await ask({ "x-udozo-store": "gadgets" })).status).toBe(200);
    expect(calls[0]!.url).toBe("https://api.udozo.test/v1/classifieds/watermark?store=gadgets");
  }, 60_000);

  test("without the shared secret nothing is asked for", async () => {
    delete process.env.STORE_SERVER_SECRET;
    const res = await servePhoto(`${id}.jpg`, new URLSearchParams("m=u3"), null);
    expect([res.status, res.headers.get("cache-control")]).toEqual([502, "no-store"]);
    expect(calls.some(call => call.url.includes("/original"))).toBe(false);
  });
});

describe("drawing the mark", () => {
  test("resized, never larger, and the mark drawn in the bottom-right corner", async () => {
    const original = await photo(1200, 800);
    const marked = await watermarkPhoto(original, "udozo.com", 960);
    const meta = await sharp(marked).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 960, 640]);

    // The bottom-right corner differs from the plain photo there (the text); the top-left corner does not.
    const plain = await sharp(original).resize({ width: 960 }).raw().toBuffer();
    const drawn = await sharp(marked).raw().toBuffer();
    const differs = (x0: number, y0: number, w: number, h: number) => {
      let total = 0;
      for (let y = y0; y < y0 + h; y += 1) for (let x = x0; x < x0 + w; x += 1) for (let c = 0; c < 3; c += 1) total += Math.abs(drawn[(y * 960 + x) * 3 + c]! - plain[(y * 960 + x) * 3 + c]!);
      return total / (w * h * 3);
    };
    expect(differs(960 - 260, 640 - 70, 240, 50)).toBeGreaterThan(8);
    expect(differs(10, 10, 60, 40)).toBeLessThan(3);

    const small = await sharp(await watermarkPhoto(await photo(300, 200), "udozo.com", 480)).metadata();
    expect([small.width, small.height]).toEqual([300, 200]);
  }, 60_000);
});
