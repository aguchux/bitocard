import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { campaignOf, startLinks } from "@/lib/start-here";

vi.mock("@/lib/api", () => ({
  markets: async () => ({ showcase: false, data: [{ object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 12, safe_pay: true, install_prompt: false }] }),
}));
vi.mock("@/lib/reference", () => ({
  categoriesOf: async () => [
    { slug: "phones-tablets", name: "Phones and tablets", icon: "smartphone", children: [], safety_checklist: [] },
    { slug: "vehicles", name: "Vehicles", icon: "car", children: [], safety_checklist: [] },
  ],
}));

describe("Start here's links", () => {
  it("carry a campaign's referral and tags on to sign-up, then posting a listing", () => {
    const links = startLinks(campaignOf({ ref: "ada-01", utm_source: "facebook", utm_campaign: "launch_ng", other: "dropped" }));
    expect(links.sell).toBe("/signup?next=%2Fsell&ref=ada-01&utm_source=facebook&utm_campaign=launch_ng");
    expect(links.store).toBe("https://shq.udozo.com/signup?ref=ada-01&utm_source=facebook&utm_campaign=launch_ng");
  });

  it("leave out tags that are long, repeated or carry odd characters", () => {
    expect(campaignOf({ ref: "x".repeat(65), utm_source: "<script>", utm_medium: ["cpc", "second"], utm_term: "" })).toEqual([["utm_medium", "cpc"]]);
    expect(startLinks([])).toEqual({ sell: "/signup?next=%2Fsell", store: "https://shq.udozo.com/signup", signIn: "/signin?next=/sell" });
  });
});

describe("the Start here page", async () => {
  const { default: StartHerePage, metadata } = await import("@/app/start-here/page");
  const html = renderToStaticMarkup(await StartHerePage({ searchParams: Promise.resolve({ ref: "ada-01" }) }));

  it("is indexed at its own address and says what it offers", () => {
    expect(metadata.alternates?.canonical).toBe("/start-here");
    expect(String((metadata.title as { absolute: string }).absolute)).toMatch(/Start selling on Udozo/);
    expect(html).toContain("<h1");
    expect(html).toContain("Start selling on Udozo today.");
    expect(html).toContain("Now open in Nigeria");
  });

  it("sends every sign-up button to sign-up with the referral, and the store button to Seller HQ", () => {
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]!.replaceAll("&amp;", "&"));
    const signUps = hrefs.filter(href => href.startsWith("/signup"));
    expect(signUps.length).toBeGreaterThanOrEqual(4);
    expect(new Set(signUps)).toEqual(new Set(["/signup?next=%2Fsell&ref=ada-01"]));
    expect(hrefs).toContain("https://shq.udozo.com/signup?ref=ada-01");
  });

  it("is honest: free to list with Safe pay's fee shown first, no setup fee, the phone an illustration", () => {
    expect(html).toContain("Free to list");
    expect(html).toContain("No setup fee");
    expect(html).toMatch(/small fee, always shown before you accept/);
    expect(html).toContain(">Illustration<");
    expect(html).not.toMatch(/guarantee|BitoCard/i);
  });

  it("lists the market's categories and answers questions", () => {
    expect(html).toContain("Phones and tablets");
    expect(html).toContain("Does it cost anything to start?");
  });
});

describe("Start here from the rest of the site", async () => {
  it("is in the footer", async () => {
    const { SiteFooter } = await import("@/components/footer");
    expect(renderToStaticMarkup(createElement(SiteFooter))).toContain('href="/start-here"');
  });
});
