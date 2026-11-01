// The country a shopper chooses in the header is remembered (`udz_market`), so udozo.com's home opens it next time; with
// All countries, the showcase across them, each card saying its area and country.
import { request, setRequest } from "./request";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const open = [
  { object: "classified_market", country: "GH", name: "Ghana", currency: "GHS", listings: 0, safe_pay: false, install_prompt: false },
  { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: false, install_prompt: false },
];
const card = (id: string, country: string, area: string) => ({
  id,
  ref: id,
  slug: "item",
  country,
  title: `Item ${id}`,
  condition: "used",
  cover: null,
  has_video: false,
  highlights: [],
  area: { name: area, state: { name: "State" } },
  published_at: "2026-11-01T10:00:00.000Z",
  seller: { badges: [] },
});
vi.mock("@/lib/api", () => ({
  markets: async () => ({ showcase: true, data: open }),
  shopApi: async () => ({ ok: true, data: { trending: [card("1", "NG", "Ikeja")], recent: [card("2", "KE", "Westlands")] } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

const { readMarketChoice, chosenOpenMarket, chooseMarketHref, marketCookie } = await import("@/lib/market-choice");
const { GET } = await import("@/app/market/[choice]/route");
const { default: GlobalHome } = await import("@/app/(global)/page");
const { CountryMenu } = await import("@/components/country-menu");

const choose = (choice: string) => GET(new NextRequest(`https://udozo.com/market/${choice}`), { params: Promise.resolve({ choice }) });

describe("the remembered country", () => {
  it("reads only a country's two letters or all", () => {
    expect(readMarketChoice("ng")).toBe("NG");
    expect(readMarketChoice("all")).toBe("all");
    for (const bad of [undefined, "", "nigeria", "n1", "../x"]) expect(readMarketChoice(bad)).toBeNull();
    expect(chosenOpenMarket("NG", open)?.name).toBe("Nigeria");
    // A market that closed, or All countries, chooses no market.
    expect(chosenOpenMarket("KE", open)).toBeNull();
    expect(chosenOpenMarket("all", open)).toBeNull();
  });

  it("choosing a country remembers it for a year, then opens its market", async () => {
    const res = await choose("ng");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://udozo.com/ng");
    const cookie = res.cookies.get(marketCookie)!;
    expect(cookie.value).toBe("NG");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("All countries is remembered too and opens the showcase; a closed or unknown country is not remembered", async () => {
    const all = await choose("all");
    expect(all.headers.get("location")).toBe("https://udozo.com/");
    expect(all.cookies.get(marketCookie)?.value).toBe("all");
    for (const choice of ["ke", "zz"]) {
      const res = await choose(choice);
      expect(res.headers.get("location")).toBe("https://udozo.com/");
      expect(res.cookies.get(marketCookie)).toBeUndefined();
    }
  });

  it("the country menu chooses through it with plain links, so prefetching or crawling never sets it", () => {
    expect(chooseMarketHref("NG")).toBe("/market/ng");
    expect(chooseMarketHref(null)).toBe("/market/all");
    const html = renderToStaticMarkup(createElement(CountryMenu, { current: null, countries: open.map(({ country, name, listings }) => ({ country, name, listings })) }));
    expect(html).toContain('href="/market/ng" rel="nofollow"');
    expect(html).toContain('href="/market/gh" rel="nofollow"');
    expect(html).toContain('href="/market/all" rel="nofollow"');
  });
});

describe("udozo.com's home", () => {
  it("opens the chosen country's market", async () => {
    setRequest({}, { [marketCookie]: "NG" });
    await expect(GlobalHome()).rejects.toThrow("redirect:/ng");
  });

  it("with All countries, a closed country or no choice, shows the showcase, each card with its area and country", async () => {
    for (const cookies of [{ [marketCookie]: "all" }, { [marketCookie]: "KE" }, {}] as Array<Record<string, string>>) {
      setRequest({}, cookies);
      const html = renderToStaticMarkup(await GlobalHome());
      expect(html).toContain("Udozo across Africa");
      // The area, then the country, which never shortens.
      expect(html).toMatch(/<span class="truncate">Ikeja,<\/span><span class="-ml-1 shrink-0">Nigeria<\/span>/);
      expect(html).toMatch(/Westlands,<\/span><span class="-ml-1 shrink-0">Kenya</);
      expect(html).toContain('src="/flags/ng.svg"');
      // Still never a price across countries.
      expect(html).not.toMatch(/₦|KSh/);
    }
    expect(request.set).toEqual([]);
  });
});
