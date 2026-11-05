// Udozo's admin wears Udozo's theme, as Seller HQ does: its logo colours from the first paint (the layout), then the
// published theme once it loads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { AdminProviders } from "@bitocard/admin-ui/shell";

await import("@/app/api-product");
const { UdozoTheme } = await import("@/components/admin-theme");

const forest = { primary: "#14532d", accent: "#b45309", ink: "#111827", page: "#ffffff" };

beforeEach(() => {
  process.env.NEXT_PUBLIC_API_URL = "http://api.test";
  vi.stubGlobal("fetch", async (input: Request) => {
    const path = new URL(input.url).pathname;
    if (path === "/v1/theme") return Response.json({ object: "theme", preset: "forest", colors: forest, version: 3, preview: false });
    return Response.json({ error: { type: "authentication_error", code: "not_signed_in", message: "Sign in.", request_id: "r" } }, { status: 401 });
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("style");
});

describe("the admin's colours", () => {
  test("follow the published theme, without asking for the admin's settings", async () => {
    render(
      <AdminProviders>
        <UdozoTheme />
      </AdminProviders>,
    );
    await waitFor(() => expect(document.documentElement.style.getPropertyValue("--color-navy-900")).toBe("#14532d"));
    expect(document.documentElement.style.getPropertyValue("--color-brand-500")).toBe("#b45309");
  });

  test("both consoles start in Udozo's logo colours, written into the page before it draws", () => {
    for (const app of ["udozo-admin", "udozo-shq"]) {
      const layout = readFileSync(join(__dirname, "..", "..", app, "app", "layout.tsx"), "utf8");
      expect(layout, app).toContain("consoleThemeCss(udozoConsoleColors)");
      expect(layout, app).toContain("<UdozoTheme />");
      expect(layout, app).not.toContain("#070f4c");
      expect(readFileSync(join(__dirname, "..", "..", app, "app", "manifest.ts"), "utf8"), app).toContain('theme_color: "#185174"');
    }
  });
});
