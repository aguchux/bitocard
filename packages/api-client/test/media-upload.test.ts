// Uploads go through the API (`POST …/media/:id/content`), which stores the file with the signed link's own key, so
// storage's CORS rule never matters (admin.udozo.com could not upload before it was added). A network failure, and the
// API's refusal, are said in words.
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadMedia } from "../src/media";

const created = { id: "m1", upload: { url: "https://bucket.test/uploads/m1.png", method: "PUT", headers: { "Content-Type": "image/png", "x-amz-acl": "private" } } };
const dispatch = vi.fn(() => ({ unwrap: async () => created }));
const file = Object.assign(new Blob(["png"], { type: "image/png" }), { name: "banner.png" });
const upload = () => uploadMedia(dispatch, "admin", { purpose: "banner_image" }, file);

afterEach(() => vi.unstubAllGlobals());

describe("uploading a file", () => {
  it("sends its bytes to the API, never to storage", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      urls.push(`${init.method} ${url}`);
      return Response.json({ object: "media_asset", id: "m1", url: "https://media.test/m1.png", status: "ready" });
    });
    await expect(upload()).resolves.toMatchObject({ url: "https://media.test/m1.png" });
    expect(urls).toEqual([expect.stringMatching(/^POST .*\/v1\/admin\/media\/m1\/content$/)]);
  });

  it("says when the API cannot be reached, and its refusal in its own words", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(upload()).rejects.toMatchObject({ status: 0, code: "network_error" });
    vi.stubGlobal("fetch", async () => Response.json({ error: { type: "conflict_error", code: "upload_expired", message: "This upload has expired. Choose the file again." } }, { status: 409 }));
    await expect(upload()).rejects.toMatchObject({ status: 409, message: "This upload has expired. Choose the file again." });
  });
});
