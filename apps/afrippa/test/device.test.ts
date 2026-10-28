import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const { proxy } = await import("@/proxy");
const { newDeviceId, validDeviceId } = await import("@/lib/device");
const { customerApi } = await import("@/lib/customer");

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the device ID for Afrippa's device checks", () => {
  test("a random ID in the right shape, never repeated", () => {
    const one = newDeviceId();
    expect(validDeviceId(one)).toBe(true);
    expect(one).not.toBe(newDeviceId());
    for (const bad of ["", "afd_short", `bcv_${"a".repeat(43)}`, undefined]) expect(validDeviceId(bad)).toBe(false);
  });

  test("a browser without one gets one in a host-only, httpOnly cookie, added to the same request; one with one keeps it", () => {
    const first = proxy(new NextRequest("https://afrippa.com/ng", { headers: { cookie: "afr_session=bcc_x" } }));
    const set = first.cookies.get("afr_device")!;
    expect(validDeviceId(set.value)).toBe(true);
    expect(set).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 });
    expect(set.domain).toBeUndefined();
    expect(first.headers.get("x-middleware-request-cookie") ?? first.headers.get("x-middleware-override-headers") ?? "").not.toBe("");

    const known = newDeviceId();
    const again = proxy(new NextRequest("https://afrippa.com/ng", { headers: { cookie: `afr_device=${known}` } }));
    expect(again.cookies.get("afr_device")).toBeUndefined();
  });

  test("API calls send it as Afrippa-Device, and never a malformed one", async () => {
    const id = newDeviceId();
    setRequest({}, { afr_device: id });
    await customerApi("GET", "/v1/afrippa/account");
    expect((fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }])[1].headers["afrippa-device"]).toBe(id);
    setRequest({}, { afr_device: "afd_forged" });
    await customerApi("GET", "/v1/afrippa/account");
    expect((fetchMock.mock.calls[1] as [string, { headers: Record<string, string> }])[1].headers["afrippa-device"]).toBeUndefined();
  });
});
