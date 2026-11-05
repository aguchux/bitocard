// Udozo's colour theme, chosen by its admins (`GET /v1/theme`), on every page; `?theme_preview=` shows the draft.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { setRequest } from "./request";
import { fallbackTheme, previewHeader, siteTheme, themeCss, themeVars } from "@/lib/theme";
import { proxy } from "@/proxy";

const forest = { primary: "#14532d", accent: "#b45309", ink: "#111827", page: "#ffffff" };
const draft = { primary: "#0c4a6e", accent: "#0e7490", ink: "#0f172a", page: "#ffffff" };
const token = `${Date.now() + 60_000}.${"a".repeat(43)}`;
let asked: Array<{ url: string; init: RequestInit }>;

beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  setRequest({ host: "udozo.com" });
  asked = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    asked.push({ url, init });
    if (url.includes("preview=")) return url.includes(token) ? Response.json({ object: "theme", preset: null, colors: draft, version: 2, preview: true }) : Response.json({ error: { code: "preview_expired" } }, { status: 401 });
    return Response.json({ object: "theme", preset: "forest", colors: forest, version: 1, preview: false });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the theme", () => {
  test("the published theme, cached a minute", async () => {
    expect(await siteTheme()).toEqual({ colors: forest, preview: false });
    expect(asked[0]!.url).toBe("https://api.test/v1/theme");
    expect(asked[0]!.init).toMatchObject({ next: { revalidate: 60 } });
  });

  test("a preview token shows the draft, never cached; an expired or malformed one shows the published theme", async () => {
    expect(await siteTheme(token)).toEqual({ colors: draft, preview: true });
    expect(asked[0]!.init).toMatchObject({ cache: "no-store" });
    expect(await siteTheme(`${Date.now() + 60_000}.${"b".repeat(43)}`)).toEqual({ colors: forest, preview: false });
    asked = [];
    expect(await siteTheme("../../v1/admin")).toEqual({ colors: forest, preview: false });
    expect(asked.map(call => call.url)).toEqual(["https://api.test/v1/theme"]);
  });

  test("the API unreachable, or a colour that is not #rrggbb: navy and pink", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await siteTheme()).toEqual({ colors: fallbackTheme, preview: false });
    expect(fallbackTheme).toEqual({ primary: "#185174", accent: "#0e7cc0", ink: "#10212e", page: "#ffffff" });
    vi.stubGlobal("fetch", async () => Response.json({ object: "theme", colors: { ...forest, page: "white;}body{display:none" } }));
    expect((await siteTheme()).colors).toEqual(fallbackTheme);
  });

  test("its colours re-point the variables every utility reads: navy from primary, pink from accent, body text and page", () => {
    const vars = themeVars(forest);
    expect(vars["--color-navy-900"]).toBe("#14532d");
    expect(vars["--color-brand-500"]).toBe("#b45309");
    expect(vars["--color-ink"]).toBe("#111827");
    expect(vars["--color-page"]).toBe("#ffffff");
    expect(vars["--color-navy-200"]).toBe("color-mix(in srgb, #14532d 12%, white)");
    expect(vars["--color-brand-700"]).toBe("color-mix(in srgb, #b45309 76%, black)");
    const css = themeCss(forest);
    expect(css.startsWith("html:root{")).toBe(true);
    expect(css).toContain("--color-navy-900:#14532d;");
  });
});

describe("the proxy passes an admin's preview to the page", () => {
  const nextHeader = (response: Response) => response.headers.get(`x-middleware-request-${previewHeader}`);

  test("?theme_preview= on any page becomes the request header; nothing else does", async () => {
    expect(nextHeader(await proxy(new NextRequest(`https://udozo.com/ng?theme_preview=${encodeURIComponent(token)}`)))).toBe(token);
    expect(nextHeader(await proxy(new NextRequest("https://udozo.com/account?theme_preview=nonsense")))).toBeNull();
    // A header the browser sent itself is never passed on.
    expect(nextHeader(await proxy(new NextRequest("https://udozo.com/ng", { headers: { [previewHeader]: token } })))).toBeNull();
  });
});

/** A Tailwind colour class of the navy, brand or pink scale, capturing the shade (`navy-300`). */
const SHADE = /\b(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration|accent|caret|divide)-((?:navy|brand|pink)-\d+)\b/g;

/** Every source file of the site's pages, components and helpers. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("every colour follows the theme", () => {
  test("each navy, brand and pink shade the site uses has its theme variable, so none stays BitoCard's", () => {
    const used = new Set<string>();
    for (const file of ["app", "components", "lib"].flatMap(dir => sources(join(__dirname, "..", dir)))) {
      for (const match of readFileSync(file, "utf8").matchAll(SHADE)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(10);
    const vars = themeVars(fallbackTheme);
    expect([...used].filter(shade => !vars[`--color-${shade}`])).toEqual([]);
  });
});
