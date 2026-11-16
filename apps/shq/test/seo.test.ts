// SHQ is private except its public doors: sign-up and sign-in are indexable with canonical links, cards and a
// sitemap; everything else stays noindex and out of robots.txt.
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";

vi.mock("next/font/google", () => ({ Inter: () => ({ variable: "font-inter" }) }));
vi.stubEnv("SHQ_URL", "https://shq.bitocard.com");

const { metadata: root } = await import("@/app/layout");
const { metadata: signup } = await import("@/app/signup/page");
const { metadata: signin } = await import("@/app/signin/page");
const { default: robots } = await import("@/app/robots");
const { default: sitemap } = await import("@/app/sitemap");

describe("SHQ search engines", () => {
  test("the back office is noindex by default, on SHQ's own address", () => {
    expect(root.robots).toEqual({ index: false, follow: false });
    expect(String(root.metadataBase)).toBe("https://shq.bitocard.com/");
  });

  test("sign-up and sign-in are indexable, canonical and carry share cards", () => {
    for (const [page, path] of [
      [signup, "/signup"],
      [signin, "/signin"],
    ] as const) {
      expect(page.robots).toMatchObject({ index: true, follow: true });
      expect(page.alternates?.canonical).toBe(path);
      expect(page.openGraph).toMatchObject({ url: path, siteName: "BitoCard SHQ" });
      expect(page.twitter).toMatchObject({ card: "summary_large_image", images: ["/opengraph-image"] });
      expect(page.openGraph).toMatchObject({ images: [{ url: "/opengraph-image", width: 1200, height: 630 }] });
      expect(String(page.description).length).toBeGreaterThan(70);
    }
  });

  test("robots.txt lets crawlers see only the public doors, and names the sitemap", () => {
    const rules = robots();
    expect(rules.rules).toEqual({ userAgent: "*", allow: ["/signup", "/signin", "/opengraph-image"], disallow: "/" });
    expect(rules.sitemap).toBe("https://shq.bitocard.com/sitemap.xml");
    expect(sitemap().map(entry => entry.url)).toEqual(["https://shq.bitocard.com/signup", "https://shq.bitocard.com/signin"]);
  });

  test("no blanket noindex header, which would override the public pages", () => {
    expect(readFileSync("next.config.ts", "utf8")).toMatch(/indexable: true/);
  });
});
