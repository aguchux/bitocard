// @vitest-environment jsdom
// Profile photos on udozo.com: a customer's photo or their initials (also when a photo fails to load); the profile's
// photo form asking Udozo for a signed link, sending the photo to storage and setting it; how a photo is fitted into
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
  startAvatarUpload: vi.fn(async (file: { content_type: string }) => {
    calls.push(`start ${file.content_type}`);
    return { ok: true, data: { id: "11111111-1111-4111-8111-111111111111", upload: { method: "PUT", url: "https://storage.test/put", headers: { "content-type": "image/jpeg" } } } };
  }),
  setAvatar: vi.fn(async (id: string) => {
    calls.push(`set ${id}`);
    return { ok: true, data: { avatar_url: "https://media.test/me.jpg" } };
  }),
  removeAvatar: vi.fn(async () => {
    calls.push("remove");
    return { ok: true, data: { avatar_url: null } };
  }),
}));

const { Avatar, avatarInitials } = await import("@bitocard/ui/avatar");
const { squareDraw } = await import("@bitocard/ui/image");
const { AvatarForm } = await import("@/components/account/avatar-form");

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
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url} ${init.credentials}`);
    return new Response(null, { status: 200 });
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

  it("is chosen on the profile, sent straight to storage with the signed link, then set", async () => {
    const host = mount(createElement(AvatarForm, { name: "Chinedu Okafor", url: null }));
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      Object.defineProperty(input, "files", { value: [new File(["x"], "me.jpg", { type: "image/jpeg" })], configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const save = [...host.querySelectorAll("button")].find(button => button.textContent === "Save photo")!;
    await act(async () => save.click());
    expect(calls).toEqual(["start image/jpeg", "PUT https://storage.test/put omit", "set 11111111-1111-4111-8111-111111111111"]);
    expect(refresh).toHaveBeenCalled();
    expect(host.textContent).toContain("Your photo is saved.");
  });

  it("is taken off", async () => {
    const host = mount(createElement(AvatarForm, { name: "Chinedu Okafor", url: "https://media.test/me.jpg" }));
    const remove = [...host.querySelectorAll("button")].find(button => button.textContent === "Remove photo")!;
    await act(async () => remove.click());
    expect(calls).toEqual(["remove"]);
    expect(host.textContent).toContain("Your initials show instead.");
  });
});
