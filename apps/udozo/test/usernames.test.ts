// @vitest-environment jsdom
// Usernames on udozo.com (docs/UDOZO_USERNAMES_PLAN.md): seller pages live at the username once chosen (the handle, an
// old username and another case redirect there for good, keeping the query), links, the sitemap and share cards follow,
// Profile > Username checks as people type and says why a name cannot be theirs, the account pages' banner asks while
// the API says to and hides on Not now, and the seller's own page offers one.
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ShopSearch, ShopSellerProfile, ShopSitemap, UsernameStatus } from "@bitocard/api-client/classifieds";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const market = { object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 21, safe_pay: true, install_prompt: false };
const profile = (extra: Partial<ShopSellerProfile> & { redirect?: string } = {}): ShopSellerProfile => ({
  object: "classified_seller",
  handle: "a1b2c3d4e5",
  username: "chinedu",
  name: "Chinedu O.",
  avatar_url: null,
  country: "NG",
  url: "https://udozo.com/ng/seller/chinedu",
  member_since: "2026-03-02T10:00:00.000Z",
  badges: [],
  response_rate: 92,
  active_listings: 3,
  sold_listings: 0,
  safe_pay_sales: 0,
  last_listed_at: "2026-11-01T10:00:00.000Z",
  categories: [{ slug: "tvs", name: "TVs", icon: "tv", parent: null, listings: 3 }],
  states: [{ slug: "lagos", name: "Lagos", listings: 3 }],
  contact: { chat: true, phone: true },
  contact_listings: [{ id: "11111111-1111-4111-8111-111111111111", ref: 101, title: "Hisense TV", slug: "hisense-tv", currency: "NGN", chat: true, phone: true }],
  ...extra,
});
const status = (extra: Partial<UsernameStatus> = {}): UsernameStatus => ({ object: "username_status", username: null, posted: 2, required: 5, eligible: false, change_after: null, prompt: false, dismissals: 0, ...extra });
const emptySearch: ShopSearch = { object: "list", data: [], total: 0, tiers: null, offset: 0, limit: 24, sort: "newest" };

const api = {
  profile: profile() as ShopSellerProfile | null,
  search: emptySearch as ShopSearch | null,
  paths: [] as string[],
  customerPaths: [] as string[],
  signedIn: false,
  own: false,
  status: status() as UsernameStatus | null,
};
vi.mock("@/lib/api", () => ({
  marketFor: async (cc: string) => (cc === "ng" ? market : null),
  shopApi: async (path: string) => {
    api.paths.push(path);
    if (path.startsWith("/v1/classifieds/sellers/")) return api.profile ? { ok: true, data: api.profile } : { ok: false, status: 404, code: "resource_missing" };
    if (path.startsWith("/v1/classifieds/listings?")) return api.search ? { ok: true, data: api.search } : { ok: false, status: 0, code: null };
    return { ok: false, status: 404, code: null };
  },
}));
const customer = { id: "c1", country: "NG", phone: null, phone_verified: false, name: "Chinedu Okafor", username: null };
vi.mock("@/lib/customer", () => ({
  currentCustomer: async () => (api.signedIn ? customer : null),
  customerApi: async (_method: string, path: string) => {
    api.customerPaths.push(path);
    if (path === "/v1/store/account/username") return api.status ? { ok: true, data: api.status } : { ok: false, status: 0, code: null, message: "down", param: null };
    if (path.endsWith("/viewer")) return { ok: true, data: { object: "classified_listing_viewer", listing_id: "11111111-1111-4111-8111-111111111111", own: api.own, favourite: false, conversation_id: null, order: null, can_contact: !api.own, contact: { available: true, shared: null, request: null }, callback: { available: true, request: null }, seller_online: false, calls: false } };
    return { ok: false, status: 404, code: null, message: "No", param: null };
  },
  siteOrigin: () => "https://udozo.com",
}));
vi.mock("@/lib/account", () => ({ requireCustomer: async () => customer }));
vi.mock("@/lib/listing-actions", () => ({ listingContactState: vi.fn(), saveListing: vi.fn(), reportListing: vi.fn(), requestContact: vi.fn() }));
const actions = vi.hoisted(() => ({ checkUsername: vi.fn(), saveUsername: vi.fn(), dismissUsernamePrompt: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/username-actions", () => actions);
const nav = vi.hoisted(() => ({ pathname: "/account" }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not-found");
  },
  permanentRedirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const { default: SellerPage, generateMetadata } = await import("@/app/[cc]/seller/[handle]/page");
const { GET: cardRoute } = await import("@/app/seller-card/[file]/route");
const { default: UsernamePage } = await import("@/app/(account)/account/profile/username/page");
const { UsernameBanner } = await import("@/components/account/username-banner");
const { UsernameForm } = await import("@/components/account/username-form");
const { readSellerCard } = await import("@/lib/seller-card");
const { isSellerKey, queryString } = await import("@/lib/seller");
const { countryEntries } = await import("@/lib/sitemap");
const { adsToGo, availabilityText, bannerShown, changeAfterText, moreAdsText, usernameChecker, usernameErrorText, usernameInput, usernameNudge, usernameProblem } = await import("@/lib/username");

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

beforeEach(() => {
  api.profile = profile();
  api.search = emptySearch;
  api.paths = [];
  api.customerPaths = [];
  api.signedIn = false;
  api.own = false;
  api.status = status();
  nav.pathname = "/account";
  actions.checkUsername.mockReset();
  actions.saveUsername.mockReset();
  actions.dismissUsernamePrompt.mockClear();
});

const page = async (handle: string, query: Record<string, string> = {}) => {
  const element = await SellerPage({ params: Promise.resolve({ cc: "ng", handle }), searchParams: Promise.resolve(query) });
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  return host;
};

describe("seller page addresses", () => {
  it("send the handle, another case and an old username to the username for good, keeping the query", async () => {
    await expect(page("a1b2c3d4e5", { sort: "price_asc", category: "tvs" })).rejects.toThrow("redirect:/ng/seller/chinedu?sort=price_asc&category=tvs");
    await expect(page("Chinedu")).rejects.toThrow("redirect:/ng/seller/chinedu");
    expect(api.paths).toContain("/v1/classifieds/sellers/chinedu");
    // An old username in its 90 days: the API names where the seller is now.
    api.profile = profile({ username: "chinedu_tv", redirect: "chinedu_tv" });
    await expect(page("chinedu")).rejects.toThrow("redirect:/ng/seller/chinedu_tv");
    // A username taken away: the API sends the old one to the handle.
    api.profile = profile({ username: null, redirect: "a1b2c3d4e5" });
    await expect(page("chinedu")).rejects.toThrow("redirect:/ng/seller/a1b2c3d4e5");
    // Anything that cannot be a username or handle never reaches the API.
    api.paths = [];
    await expect(page("no-such.seller")).rejects.toThrow("not-found");
    expect(api.paths).toEqual([]);
  });

  it("serve the username itself, with its links, canonical, cards and JSON-LD at it; the search still asks by handle", async () => {
    const html = await page("chinedu");
    expect(html.querySelector('[aria-labelledby="where"]')).not.toBeNull();
    expect(api.paths).toContain("/v1/classifieds/listings?country=NG&seller=a1b2c3d4e5&sort=newest&limit=24");
    const data = [...html.querySelectorAll('script[type="application/ld+json"]')].map(script => JSON.parse(script.textContent ?? "{}")).find(item => item["@type"] === "ProfilePage");
    expect(data.url).toBe("https://udozo.com/ng/seller/chinedu");
    expect(data.mainEntity.identifier).toBe("chinedu");
    expect(data.mainEntity.image).toBe("https://udozo.com/seller-card/chinedu.jpg");

    const meta = await generateMetadata({ params: Promise.resolve({ cc: "ng", handle: "chinedu" }), searchParams: Promise.resolve({}) });
    expect(meta.alternates?.canonical).toBe("/ng/seller/chinedu");
    expect((meta.openGraph as { images: Array<{ url: string }> }).images.map(image => image.url)).toEqual(["https://udozo.com/seller-card/chinedu.gif", "https://udozo.com/seller-card/chinedu.jpg"]);
    // Without a username, the handle as before.
    api.profile = profile({ username: null });
    const plain = await generateMetadata({ params: Promise.resolve({ cc: "ng", handle: "a1b2c3d4e5" }), searchParams: Promise.resolve({}) });
    expect(plain.alternates?.canonical).toBe("/ng/seller/a1b2c3d4e5");
  });

  it("accept usernames and handles only, and keep repeated query values", () => {
    for (const key of ["chinedu", "a1b2c3d4e5", "abc", "chi_nedu9"]) expect(isSellerKey(key), key).toBe(true);
    for (const key of ["ab", "1abc", "chi-nedu", "Chinedu", "a".repeat(25), "../x"]) expect(isSellerKey(key), key).toBe(false);
    expect(queryString({ a: ["1", "2"], b: undefined, c: "x y" })).toBe("?a=1&a=2&c=x+y");
    expect(queryString({})).toBe("");
  });

  it("links from listings and the sitemap use the username once chosen", () => {
    const listing = read("../app/[cc]/l/[listing]/page.tsx");
    expect(listing).toContain("sellerPath(cc, sellerSlug(listing.seller))");
    expect(listing).not.toContain("listing.seller.handle");
    const sitemap: ShopSitemap = {
      object: "classified_sitemap",
      country: "NG",
      updated_at: null,
      categories: [],
      places: [],
      category_places: [],
      listing_pages: [],
      sellers: [
        { handle: "a1b2c3d4e5", username: "chinedu", listings: 2, updated_at: "2026-11-02T08:00:00.000Z" },
        { handle: "zz9yy8xx7w", username: null, listings: 1, updated_at: "2026-11-01T08:00:00.000Z" },
      ],
    };
    const locs = countryEntries("https://udozo.com", "ng", sitemap).map(entry => entry.loc);
    expect(locs).toContain("https://udozo.com/ng/seller/chinedu");
    expect(locs).toContain("https://udozo.com/ng/seller/zz9yy8xx7w");
    expect(locs.some(loc => loc.includes("a1b2c3d4e5"))).toBe(false);
  });
});

describe("share cards", () => {
  it("take a username or a handle, and ask for the listings by handle", async () => {
    expect(readSellerCard("chinedu_o.gif")).toEqual({ key: "chinedu_o", kind: "gif" });
    expect(readSellerCard("a1b2c3d4e5.jpg")).toEqual({ key: "a1b2c3d4e5", kind: "jpg" });
    for (const file of ["Chinedu.gif", "ab.gif", "1abc.jpg", "chi-nedu.gif", "chinedu.png"]) expect(readSellerCard(file), file).toBeNull();
    api.search = null;
    const response = await cardRoute(new NextRequest("https://udozo.com/seller-card/chinedu_o.jpg", { headers: { host: "udozo.com" } }), { params: Promise.resolve({ file: "chinedu_o.jpg" }) });
    expect(response.status).toBe(502);
    expect(api.paths).toEqual(["/v1/classifieds/sellers/chinedu_o", "/v1/classifieds/listings?country=NG&seller=a1b2c3d4e5&sort=newest&limit=24"]);
  });
});

describe("the seller's own page", () => {
  it("offers a username to the seller with none, or says how many ads to go; never to buyers", async () => {
    api.profile = profile({ username: null });
    api.signedIn = true;
    api.own = true;
    const before = await page("a1b2c3d4e5");
    const card = before.querySelector('[aria-labelledby="username-nudge"]');
    expect(card?.textContent).toContain("Post 3 more ads to choose a username");
    expect(card?.querySelector("a")?.getAttribute("href")).toBe("/account/profile/username");

    api.status = status({ eligible: true, posted: 6 });
    const ready = await page("a1b2c3d4e5");
    expect(ready.querySelector('[aria-labelledby="username-nudge"]')?.textContent).toContain("Choose a username for a better address");

    api.own = false;
    api.customerPaths = [];
    expect((await page("a1b2c3d4e5")).querySelector('[aria-labelledby="username-nudge"]')).toBeNull();
    expect(api.customerPaths).not.toContain("/v1/store/account/username");
    // With a username already, nothing to offer (and nothing asked).
    api.own = true;
    api.profile = profile();
    api.customerPaths = [];
    expect((await page("chinedu")).querySelector('[aria-labelledby="username-nudge"]')).toBeNull();
    expect(api.customerPaths).not.toContain("/v1/store/account/username");
  });
});

describe("the field's words and checking", () => {
  it("lower-cases what is typed and says what is wrong before asking", () => {
    expect(usernameInput("Chi Nedu")).toBe("chinedu");
    expect(usernameProblem("")).toBeNull();
    expect(usernameProblem("chinedu")).toBeNull();
    expect(usernameProblem("9lives")).toMatch(/^Start with a letter/);
    expect(usernameProblem("ab")).toMatch(/^Too short/);
    expect(usernameProblem(`a${"b".repeat(24)}`)).toMatch(/^Too long/);
    expect(usernameProblem("chi-nedu")).toMatch(/^Only lower-case letters, numbers and underscores/);
  });

  it("words the API's answers and refusals", () => {
    expect(availabilityText({ username: "chinedu", available: true, reason: null })).toEqual({ tone: "ok", text: "chinedu is free." });
    expect(availabilityText({ username: "chinedu", available: false, reason: "own" }).text).toBe("This is already yours.");
    expect(availabilityText({ username: "ada", available: false, reason: "taken" }).text).toBe("Someone already has this username. Try another.");
    expect(availabilityText({ username: "support", available: false, reason: "reserved" }).text).toBe("This name is kept for Udozo. Try another.");
    expect(availabilityText({ username: "rude", available: false, reason: "refused" }).text).toBe("This username is not allowed. Try another.");
    expect(availabilityText({ username: "x", available: false, reason: "invalid" }).text).toMatch(/^3 to 24 characters/);
    expect(usernameErrorText({ status: 409, code: "username_change_too_soon", message: "You can change your username again from 5 December 2026." })).toBe("You can change your username again from 5 December 2026.");
    expect(usernameErrorText({ status: 409, code: "username_taken", message: "x" })).toBe("Someone already has this username. Try another.");
    expect(usernameErrorText({ status: 429, code: "username_check_limit", message: "x" })).toMatch(/^Too many checks/);
    expect(usernameErrorText({ status: 401, code: null, message: "x" })).toBe("Sign in again to carry on.");
  });

  it("asks a moment after the last key, and shows only the newest answer", async () => {
    vi.useFakeTimers();
    try {
      const answers: string[] = [];
      const resolvers: Record<string, (value: string) => void> = {};
      const ask = vi.fn((value: string) => new Promise<string>(resolve => (resolvers[value] = resolve)));
      const checker = usernameChecker(ask, (value, result) => answers.push(`${value}:${result}`), 400);
      checker.check("c");
      checker.check("ch");
      vi.advanceTimersByTime(399);
      expect(ask).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(ask).toHaveBeenCalledTimes(1);
      expect(ask).toHaveBeenCalledWith("ch");
      // A newer question before the older answer: the older one is dropped.
      checker.check("chi");
      vi.advanceTimersByTime(400);
      resolvers.ch!("old");
      resolvers.chi!("new");
      await vi.runAllTimersAsync();
      expect(answers).toEqual(["chi:new"]);
      checker.check("chin");
      checker.cancel();
      vi.advanceTimersByTime(1000);
      expect(ask).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks in the form, offers suggestions to tap, and saves only a free name", async () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      actions.checkUsername.mockImplementation(async (value: string) => ({ ok: true, data: { object: "username_availability", username: value, available: value !== "chinedu", reason: value === "chinedu" ? "taken" : null, suggestions: value === "chinedu" ? ["chinedu_ng", "chinedu2"] : [] } }));
      actions.saveUsername.mockResolvedValue({ ok: true, data: status({ username: "chinedu_ng", eligible: true }) });
      act(() => root.render(createElement(UsernameForm, { current: null, addressPrefix: "udozo.com/ng/seller/" })));
      const input = host.querySelector("input")!;
      const type = async (value: string) => {
        await act(async () => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          setter.call(input, value);
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
      };
      await type("Chi");
      expect(input.value).toBe("chi");
      await type("Chinedu");
      expect(host.textContent).toContain("Checking…");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(actions.checkUsername).toHaveBeenCalledTimes(1);
      expect(actions.checkUsername).toHaveBeenCalledWith("chinedu");
      expect(host.textContent).toContain("Someone already has this username. Try another.");
      const save = [...host.querySelectorAll("button")].find(button => button.type === "submit")!;
      expect(save.disabled).toBe(true);
      const chip = [...host.querySelectorAll("button")].find(button => button.textContent === "chinedu_ng")!;
      await act(async () => chip.click());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400);
      });
      expect(host.textContent).toContain("chinedu_ng is free.");
      expect(save.disabled).toBe(false);
      await act(async () => save.click());
      expect(actions.saveUsername).toHaveBeenCalledWith("chinedu_ng");
      expect(host.textContent).toContain("Saved. Your page is now udozo.com/ng/seller/chinedu_ng.");
      // A rule broken is said at once, without asking.
      await type("9x");
      expect(host.textContent).toContain("Start with a letter.");
      expect(actions.checkUsername).toHaveBeenCalledTimes(2);
    } finally {
      act(() => root.unmount());
      host.remove();
      vi.useRealTimers();
    }
  });
});

describe("Profile > Username", () => {
  const screen = async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(await UsernamePage());
    return host;
  };

  it("says how many ads to go before they can choose", async () => {
    expect(adsToGo({ posted: 7, required: 5 })).toBe(0);
    expect(moreAdsText({ posted: 4, required: 5 })).toBe("Post 1 more ad to choose a username");
    const html = await screen();
    expect(html.textContent).toContain("Post 3 more ads to choose a username");
    expect(html.textContent).toContain("You have posted 2 of the 5 ads needed.");
    expect(html.querySelector('a[href="/sell?from=username"]')?.textContent).toContain("Post an ad");
    expect(html.querySelector("input")).toBeNull();
  });

  it("offers the field once eligible; shows the address with Copy and when it can change next", async () => {
    api.status = status({ eligible: true, posted: 5 });
    expect((await screen()).querySelector('input[name="username"]')).not.toBeNull();
    api.status = status({ eligible: true, posted: 9, username: "chinedu", change_after: "2099-12-05T10:00:00.000Z" });
    const set = await screen();
    expect(set.querySelector('a[href="https://udozo.com/ng/seller/chinedu"]')?.textContent).toBe("udozo.com/ng/seller/chinedu");
    expect(set.textContent).toContain("Copy");
    expect(set.textContent).toContain("You can change it again from 5 December 2099.");
    expect(set.querySelector("input")).toBeNull();
    expect(changeAfterText({ username: "chinedu", change_after: "2020-01-01T00:00:00.000Z" })).toBeNull();
    api.status = null;
    expect((await screen()).textContent).toContain("could not be loaded");
  });
});

describe("the banner", () => {
  it("shows only while the API asks, and hides at once on Not now, telling Udozo", async () => {
    expect(bannerShown(status({ prompt: true }))).toBe(true);
    expect(bannerShown(status({ prompt: false }))).toBe(false);
    expect(bannerShown(null)).toBe(false);
    const layout = read("../app/(account)/layout.tsx");
    expect(layout).toContain("bannerShown(username.data)");
    expect(layout).toContain('customerApi<UsernameStatus>("GET", "/v1/store/account/username")');

    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(UsernameBanner, { example: "udozo.com/ng/seller/yourname" })));
    expect(host.textContent).toContain("Choose your username: your page becomes udozo.com/ng/seller/yourname.");
    expect(host.querySelector("a")?.getAttribute("href")).toBe("/account/profile/username");
    const notNow = [...host.querySelectorAll("button")].find(button => button.textContent === "Not now")!;
    await act(async () => notNow.click());
    expect(host.textContent).toBe("");
    expect(actions.dismissUsernamePrompt).toHaveBeenCalledTimes(1);
    act(() => root.unmount());

    // Never on the Username screen itself.
    nav.pathname = "/account/profile/username";
    expect(renderToStaticMarkup(createElement(UsernameBanner, { example: "x" }))).toBe("");
  });

  it("the nudge's words follow the status", () => {
    expect(usernameNudge(status({ username: "chinedu" }))).toBeNull();
    expect(usernameNudge(status())?.title).toBe("Post 3 more ads to choose a username");
    expect(usernameNudge(status({ eligible: true }))?.title).toBe("Choose a username for a better address");
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});
