import { NextResponse, type NextRequest } from "next/server";
import { deviceCookie, newDeviceId, validDeviceId } from "./lib/device";

/**
 * Every page and server action (never files or `_next`): a browser without this site's device ID gets one, a random
 * value in its own host-only, httpOnly cookie (`afr_device`, a year). It is added to this request too, so the first
 * page's calls to the API already carry it (`lib/customer.ts`). The API keeps only a keyed hash, for Afrippa's device
 * checks: a new device at sign-in, one device on both sides of an order, many accounts from one device.
 */
export function proxy(request: NextRequest) {
  if (validDeviceId(request.cookies.get(deviceCookie)?.value)) return NextResponse.next();
  const id = newDeviceId();
  const headers = new Headers(request.headers);
  const others = request.headers.get("cookie");
  headers.set("cookie", `${others ? `${others}; ` : ""}${deviceCookie}=${id}`);
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set({ name: deviceCookie, value: id, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/|.*\\.[a-zA-Z0-9]+$).*)" }],
};
