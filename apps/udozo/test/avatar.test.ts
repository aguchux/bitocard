// @vitest-environment jsdom
// Profile photos on udozo.com: a customer's photo or their initials (also when a photo fails to load); the profile's
// photo form sending the photo to udozo.com's own server, which stores it with Udozo's signed link and sets it; how a photo is fitted into
// its square; and the seller page drawing the photo above its banner, not under it.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const calls: string[] = [];
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@bitocard/ui/image", async original => ({ ...(await original<typeof import("@bitocard/ui/image")>()), squareImage: vi.fn(async () => new Blob(["photo"], { type: "image/jpeg" })) }));
vi.mock("@/lib/avatar-actions", () => ({
  removeAvatar: vi.fn(async () => {
    calls.push("remove");
    return { ok: true, data: { avatar_url: null } };
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const customerApi = vi.fn();
vi.mock("@/lib/customer", () => ({ customerApi: (...args: unknown[]) => customerApi(...args) }));

const { Avatar, avatarInitials } = await import("@bitocard/ui/avatar");
const { squareDraw } = await import("@bitocard/ui/image");
const { AvatarForm } = await import("@/components/account/avatar-form");
const { storePicture } = await import("@/lib/picture-upload");

const mounted: Array<() => void> = [];
const mount = (element: ReturnType<typeof createElement>) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
  return host;
};

beforeEach(() => {
  calls.length = 0;
  refresh.mockClear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:preview", revokeObjectURL: () => undefined }));
  customerApi.mockReset();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url} ${init.credentials}`);
    return Response.json({ url: "https://media.test/new.jpg" });
  });
});
afterEach(() => {
  mounted.splice(0).forEach(unmount => unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("a profile photo", () => {
  it("is the photo, or the person's initials when there is none or it does not load", () => {
    expect(avatarInitials("Chinedu O.")).toBe("CO");
    expect(avatarInitials("Ada")).toBe("A");
    expect(avatarInitials("  ")).toBe("?");
    const host = mount(createElement(Avatar, { name: "Chinedu O.", url: "https://media.test/me.jpg" }));
    const img = host.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://media.test/me.jpg");
    act(() => img.dispatchEvent(new Event("error")));
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toBe("CO");
    expect(renderToStaticMarkup(createElement(Avatar, { name: "Ada Obi", url: null }))).toContain("AO");
  });

  it("fits a picture into its square: cropped to the middle for a face, whole for a logo", () => {
    expect(squareDraw(800, 400, 512, "cover")).toEqual({ x: -256, y: 0, width: 1024, height: 512 });
    expect(squareDraw(800, 400, 512, "contain")).toEqual({ x: 0, y: 128, width: 512, height: 256 });
    expect(squareDraw(0, 400, 512, "cover").width).toBe(0);
  });

  it("is chosen on the profile, sent to this site's own server (never straight to storage) and shown at once", async () => {
    const host = mount(createElement(AvatarForm, { name: "Chinedu Okafor", url: "https://media.test/old.jpg" }));
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, "files", { value: [new File(["x"], "me.jpg", { type: "image/jpeg" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...host.querySelectorAll("button")].find(button => button.textContent === "Save photo")!;
    await act(async () => save.click());
    expect(calls).toEqual(["POST /api/account/picture/avatar same-origin"]);
    expect(refresh).toHaveBeenCalled();
    expect(host.textContent).toContain("Your photo is saved.");
    // The new photo, before the refreshed page brings its address.
    expect(host.querySelector("img")?.getAttribute("src")).toBe("https://media.test/new.jpg");
  });

  it("is stored by the server with Udozo's signed link, then set", async () => {
    customerApi
      .mockResolvedValueOnce({ ok: true, data: { id: "11111111-1111-4111-8111-111111111111", upload: { method: "PUT", url: "https://storage.test/put", headers: { "content-type": "image/jpeg", "x-amz-acl": "private" } } } })
      .mockResolvedValueOnce({ ok: true, data: { avatar_url: "https://media.test/new.jpg" } });
    const puts: Array<{ url: string; headers: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      puts.push({ url, headers: init.headers });
      return new Response(null, { status: 200 });
    });
    const result = await storePicture("avatar", new Blob(["photo"], { type: "image/jpeg" }), "me.jpg");
    expect(result).toEqual({ ok: true, url: "https://media.test/new.jpg" });
    expect(customerApi.mock.calls).toEqual([
      ["POST", "/v1/store/account/avatar/uploads", { filename: "me.jpg", content_type: "image/jpeg", size: 5 }],
      ["POST", "/v1/store/account/avatar", { media_id: "11111111-1111-4111-8111-111111111111" }],
    ]);
    expect(puts).toEqual([{ url: "https://storage.test/put", headers: { "content-type": "image/jpeg", "x-amz-acl": "private" } }]);
  });

  it("is not set when storage refuses it, and wrong pictures never leave the server", async () => {
    customerApi.mockResolvedValueOnce({ ok: true, data: { id: "11111111-1111-4111-8111-111111111111", upload: { method: "PUT", url: "https://storage.test/put", headers: {} } } });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 403 }));
    expect(await storePicture("banner", new Blob(["c"], { type: "image/png" }), "c.png")).toMatchObject({ ok: false, status: 502 });
    expect(customerApi).toHaveBeenCalledTimes(1);
    expect(await storePicture("avatar", new Blob(["x"], { type: "image/gif" }), "x.gif")).toMatchObject({ ok: false, status: 400 });
    expect(await storePicture("avatar", new Blob([new Uint8Array(3 * 1024 * 1024)], { type: "image/jpeg" }), "x.jpg")).toMatchObject({ ok: false, status: 413 });
    expect(customerApi).toHaveBeenCalledTimes(1);
  });

  it("is taken off", async () => {
    const host = mount(createElement(AvatarForm, { name: "Chinedu Okafor", url: "https://media.test/me.jpg" }));
    const remove = [...host.querySelectorAll("button")].find(button => button.textContent === "Remove photo")!;
    await act(async () => remove.click());
    expect(calls).toEqual(["remove"]);
    expect(host.textContent).toContain("Your initials show instead.");
  });
});
