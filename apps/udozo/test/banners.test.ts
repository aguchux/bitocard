// Banner ads above the account menu (placed in Udozo's admin): read for the customer's market from Udozo's API (a
// minute in caches), one of them shown at a time, labelled Ad; a page here or an https address elsewhere, never anything
// else; nothing at all while there are none or the API cannot answer.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./request";

const { bannersFor, pickBanner, safeBannerHref } = await import("@/lib/banners");
const { RailBanner } = await import("@/components/account/rail-banner");

const banner = (id: string, href = "/ng/c/mobile-phones", image_url = "https://cdn.udozo.test/platform/banners/images/a.png") => ({ object: "banner" as const, id, image_url, href, alt: `Banner ${id}` });

let urls: string[];
beforeEach(() => {
  vi.stubEnv("API_URL", "https://api.test");
  urls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const answering = (reply: () => Response) =>
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return reply();
  });

describe("reading the banners", () => {
  it("asks for the place and the customer's market, keeping only safe links and https images", async () => {
    answering(() => Response.json({ object: "list", position: "account_rail", data: [banner("a"), banner("b", "javascript:alert(1)"), banner("c", "https://partner.example.com/x"), banner("d", "/x", "http://cdn.test/a.png"), banner("e", "//evil.example.com")] }));
    const list = await bannersFor("account_rail", "NG");
    expect(urls).toEqual(["https://api.test/v1/classifieds/banners?position=account_rail&country=NG"]);
    expect(list.map(item => item.id)).toEqual(["a", "c"]);
  });

  it("is empty while the API refuses or cannot be reached, and asks without a market when there is none", async () => {
    answering(() => Response.json({ error: { code: "api_error" } }, { status: 500 }));
    expect(await bannersFor("account_rail", null)).toEqual([]);
    expect(urls).toEqual(["https://api.test/v1/classifieds/banners?position=account_rail"]);
    vi.stubGlobal("fetch", async () => {
      throw new Error("down");
    });
    expect(await bannersFor("account_rail", "NG")).toEqual([]);
  });

  it("shows one of them at a time", () => {
    const list = [banner("a"), banner("b"), banner("c")];
    expect(pickBanner([])).toBeNull();
    expect(pickBanner(list, () => 0)?.id).toBe("a");
    expect(pickBanner(list, () => 0.5)?.id).toBe("b");
    expect(pickBanner(list, () => 0.99)?.id).toBe("c");
  });

  it("links to a page here or an https address elsewhere, never another scheme", () => {
    expect(safeBannerHref("/ng/search?q=tv")).toEqual({ href: "/ng/search?q=tv", external: false });
    expect(safeBannerHref("https://partner.example.com")).toEqual({ href: "https://partner.example.com", external: true });
    for (const bad of ["javascript:alert(1)", "http://partner.example.com", "//evil.example.com", "/\\evil.example.com", "data:text/html,x"]) expect(safeBannerHref(bad)).toBeNull();
  });
});

describe("the banner above the account menu", () => {
  it("is the rail's full width, at least 2.5rem tall, labelled Ad, linking to the page", () => {
    const html = renderToStaticMarkup(createElement(RailBanner, { banner: banner("a") }));
    expect(html).toContain('aria-label="Advertisement"');
    expect(html).toMatch(/<a [^>]*href="\/ng\/c\/mobile-phones"/);
    expect(html).not.toContain('target="_blank"');
    expect(html).toMatch(/<img [^>]*alt="Banner a"[^>]*class="[^"]*min-h-10 w-full/);
    expect(html).toMatch(/>Ad<\/span>/);
  });

  it("opens another site in a new tab, marked sponsored", () => {
    const html = renderToStaticMarkup(createElement(RailBanner, { banner: banner("b", "https://partner.example.com/offer") }));
    expect(html).toMatch(/<a [^>]*href="https:\/\/partner.example.com\/offer"[^>]*target="_blank"[^>]*rel="sponsored noopener"/);
  });

  it("shows nothing for a link it cannot trust", () => {
    expect(renderToStaticMarkup(createElement(RailBanner, { banner: banner("c", "javascript:alert(1)") }))).toBe("");
  });
});
