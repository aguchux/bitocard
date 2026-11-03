// Uploads go from the browser straight to storage with a signed link. When storage gives no answer at all (its CORS
// rule does not allow the site, as for admin.udozo.com before it was added), the message says so instead of only
// blaming the connection.
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadMedia } from "../src/media";

const created = { id: "m1", upload: { url: "https://bucket.test/uploads/m1.png", method: "PUT", headers: { "Content-Type": "image/png", "x-amz-acl": "private" } } };
const dispatch = vi.fn(() => ({ unwrap: async () => created }));
const file = Object.assign(new Blob(["png"], { type: "image/png" }), { name: "banner.png" });
const upload = () => uploadMedia(dispatch, "admin", { purpose: "banner_image" }, file);

afterEach(() => vi.unstubAllGlobals());

describe("uploading to storage", () => {
  it("names the CORS rule when storage gives no answer", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(upload()).rejects.toMatchObject({ status: 0, code: "upload_failed", message: expect.stringMatching(/CORS rule must allow this address/) });
  });

  it("says an expired link, and a storage error, in words", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 403 }));
    await expect(upload()).rejects.toMatchObject({ status: 403, message: "The upload link was refused or has expired. Try again." });
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    await expect(upload()).rejects.toMatchObject({ status: 500, message: "The file could not be uploaded. Check your connection and try again." });
  });

  it("sends the file with only the signed headers and no cookies", async () => {
    const sent: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent.push(init);
      return new Response("", { status: 200 });
    });
    await upload();
    expect(sent[0]).toMatchObject({ method: "PUT", credentials: "omit", headers: created.upload.headers });
  });
});
