import { NextRequest } from "next/server";
import { describe, expect, test } from "vitest";
import { pathHeader } from "@/lib/path-header";
import { config, proxy } from "@/proxy";

describe("proxy", () => {
  test("passes the account page asked for to the layout, overriding anything the caller sent", () => {
    const response = proxy(new NextRequest("https://acme.bitocard.com/account/orders/abc?x=1", { headers: { [pathHeader]: "//evil.com" } }));
    expect(response.headers.get(`x-middleware-request-${pathHeader}`)).toBe("/account/orders/abc?x=1");
  });

  test("runs on account pages only", () => {
    expect(config.matcher).toEqual(["/account", "/account/:path*"]);
  });
});
