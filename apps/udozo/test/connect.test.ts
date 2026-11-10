// Udozo Connect on udozo.com (docs/UDOZO_CONNECT_PLAN.md, phases 2 and 3): the Connect Centre agreement applicants
// accept, the footer's links to it and to connect.udozo.com, notices' /connect/... addresses opening connect.udozo.com,
// and each market's list of Connect Centres.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRequest } from "./request";
import { connectUrl } from "@/lib/connect";
import { byState, centresPathFor, type ConnectCentre, mapLink, telLink } from "@/lib/connect-centres";
import { legalDocuments } from "@/lib/legal";

const redirected = vi.hoisted(() => ({ to: null as string | null }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (to: string) => {
    redirected.to = to;
    throw new Error("redirected");
  },
}));

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("Udozo Connect on udozo.com", () => {
  it("publishes the Connect Centre agreement at the address the API names, with the owner's rules", () => {
    const agreement = legalDocuments.find(doc => doc.slug === "connect-centres");
    expect(agreement?.title).toBe("Connect Centre agreement");
    const text = JSON.stringify(agreement);
    for (const rule of ["deposit", "72 hours", "2.1%", "48 hours", "Loss of care", "₦500 a day", "30 days in Loss of care", "auction after 90 days", "70% of the Connect fee"]) expect(text).toContain(rule);
    // The API asks applicants to accept the agreement at this path (connectAgreementPath).
    expect(read("../../udozo-api/src/connect/applications.service.ts")).toContain("export const connectAgreementPath = '/legal/connect-centres';");
  });

  it("says in the privacy notice what an application keeps, and in the cookie notice how connect.udozo.com signs in", () => {
    const privacy = JSON.stringify(legalDocuments.find(doc => doc.slug === "privacy"));
    expect(privacy).toContain("Connect Centre applications");
    expect(privacy).toContain("connect.udozo.com");
    expect(JSON.stringify(legalDocuments.find(doc => doc.slug === "cookies"))).toContain("udz_connect");
  });

  it("links to connect.udozo.com and the agreement from the footer, and sends notices' addresses there", () => {
    expect(connectUrl).toBe("https://connect.udozo.com");
    const footer = read("../components/footer.tsx");
    expect(footer).toContain("Become a Connect Centre");
    expect(footer).toContain("/connect-centres");
    expect(footer).toContain('href="/legal/connect-centres"');
    expect(read("../next.config.ts")).toContain('{ source: "/connect/:path*", destination: `${(process.env.NEXT_PUBLIC_CONNECT_URL ?? "https://connect.udozo.com")');
  });
});

const centre = (over: Partial<ConnectCentre> = {}): ConnectCentre => ({
  object: "connect_centre",
  id: "c1",
  number: "CC-000001",
  name: "Mama Ngozi Phones",
  state: { id: "s1", name: "Lagos", slug: "lagos" },
  area: { id: "a1", name: "Ikeja", slug: "ikeja" },
  address: "12 Allen Avenue",
  landmark: "Opposite the bank",
  latitude: 6.6,
  longitude: 3.35,
  hours: "Mon to Sat, 8am to 6pm",
  phone: "0803 123 4567",
  photo: "https://media.udozo.test/front.jpg",
  ...over,
});
const lagos = centre();
const abuja = centre({ id: "c2", name: "Wuse Parcel Point", state: { id: "s2", name: "Abuja (FCT)", slug: "fct" }, area: { id: "a2", name: "Wuse", slug: "wuse" }, latitude: null, longitude: null, photo: null });

describe("the Connect Centres page", () => {
  let centresReply: () => Response;
  const asked: string[] = [];

  beforeEach(() => {
    asked.length = 0;
    redirected.to = null;
    setRequest({});
    vi.stubEnv("API_URL", "https://api.udozo.test");
    centresReply = () => Response.json({ object: "list", country: "NG", data: [lagos, abuja] });
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      if (url.includes("/v1/classifieds/markets")) return Response.json({ object: "list", showcase: false, data: [{ object: "classified_market", country: "NG", name: "Nigeria", currency: "NGN", listings: 3, safe_pay: true, install_prompt: false }] });
      if (url.includes("/v1/connect/centres")) return centresReply();
      return Response.json({}, { status: 404 });
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const page = async (state?: string) => {
    const { default: Page } = await import("@/app/[cc]/connect-centres/page");
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ cc: "ng" }), searchParams: Promise.resolve({ state }) }));
  };

  it("groups centres by state, each with where it is, its hours, a number to call and a map", () => {
    expect(byState([lagos, abuja]).map(group => [group.state.name, group.centres.length])).toEqual([["Abuja (FCT)", 1], ["Lagos", 1]]);
    expect(mapLink(lagos)).toBe("https://www.google.com/maps?q=6.6,3.35");
    expect(mapLink(abuja)).toBeNull();
    expect(telLink("+234 (803) 123-4567")).toBe("tel:+2348031234567");
  });

  it("lists the market's active centres from the API", async () => {
    const html = await page();
    expect(asked.some(url => url === "https://api.udozo.test/v1/connect/centres?country=NG")).toBe(true);
    expect(html).toContain("Udozo Connect Centres in Nigeria");
    expect(html).toContain("Mama Ngozi Phones");
    expect(html).toContain("12 Allen Avenue (Opposite the bank)");
    expect(html).toContain('href="tel:08031234567"');
    expect(html).toContain('href="https://www.google.com/maps?q=6.6,3.35"');
    expect(html).toContain("Wuse Parcel Point");
    expect(html).toContain('name="state"');
    expect(html).toContain(connectUrl);
  });

  it("narrows to one state, and says when there is none there", async () => {
    const lagosOnly = await page("lagos");
    expect(lagosOnly).toContain("Mama Ngozi Phones");
    expect(lagosOnly).not.toContain("Wuse Parcel Point");
    expect(await page("kano")).toContain("No centres there yet.");
  });

  it("says when there are no centres yet, or the API could not answer, never failing", async () => {
    centresReply = () => Response.json({ object: "list", country: "NG", data: [] });
    expect(await page()).toContain("There are no Udozo Connect Centres in Nigeria yet.");
    centresReply = () => Response.json({ error: { code: "api_error" } }, { status: 503 });
    expect(await page()).toContain("We could not load the centres just now.");
  });

  it("the help menu's address opens the chosen market's list, or the only market's", async () => {
    const open = [{ country: "NG" }, { country: "GH" }];
    expect(centresPathFor("GH", open)).toBe("/gh/connect-centres");
    expect(centresPathFor("all", open)).toBeNull();
    expect(centresPathFor(null, [{ country: "NG" }])).toBe("/ng/connect-centres");
    const { default: Chooser } = await import("@/app/(global)/connect-centres/page");
    await expect(Chooser()).rejects.toThrow("redirected");
    expect(redirected.to).toBe("/ng/connect-centres");
  });
});
