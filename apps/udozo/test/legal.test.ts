import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

const { legalDocuments, legalVersion, operator } = await import("@/lib/legal");
const { default: LegalPage } = await import("@/app/(global)/legal/page");
const { default: DocumentPage, generateStaticParams } = await import("@/app/(global)/legal/[doc]/page");
const { GET: sitemapMain } = await import("@/app/sitemap-main.xml/route");
const { SiteFooter } = await import("@/components/footer");
const { termsHref } = await import("@/components/terms-accept");

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const documentHtml = async (slug: string) => render(await DocumentPage({ params: Promise.resolve({ doc: slug }) }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ object: "list", data: [], showcase: false })));
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("UDOZO_URL", "https://udozo.com");
  setRequest({ "x-real-ip": "203.0.113.7" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Udozo's legal documents", () => {
  test("every document has its page, a draft notice, contents and anchored sections; the hub lists them all", async () => {
    expect(generateStaticParams().map(item => item.doc)).toEqual(["terms", "safe-pay", "sellers", "privacy", "cookies"]);
    const hub = render(LegalPage());
    expect(hub).toContain("Draft for lawyers&#x27; review.");
    for (const doc of legalDocuments) {
      expect(hub).toContain(`href="/legal/${doc.slug}"`);
      const html = await documentHtml(doc.slug);
      expect(html).toContain(doc.title);
      expect(html).toContain("Draft for lawyers&#x27; review.");
      expect(html).toContain(`Version ${legalVersion}`);
      for (const section of doc.sections) expect(html).toContain(`id="${section.id}"`);
      expect(new Set(doc.sections.map(section => section.id)).size).toBe(doc.sections.length);
    }
  });

  test("they name De-Golojan Technologies Ltd as Udozo's operator, and never BitoCard", async () => {
    expect(operator.name).toBe("De-Golojan Technologies Ltd");
    // The same company as Afrippa's drafts name, word for word.
    const afrippa = read("../../afrippa/lib/legal.ts");
    for (const value of Object.values(operator)) expect(afrippa).toContain(value);
    const text = JSON.stringify(legalDocuments);
    for (const doc of ["terms", "sellers", "privacy"]) expect(await documentHtml(doc)).toContain(operator.name);
    expect(text).not.toMatch(/BitoCard|Bitocard|Golojan Ltd|legals\./);
    expect(text).toContain("legal@udozo.com");
    expect(text).toContain("support@udozo.com");
  });

  test("the version people accept is the API's, and the API links the terms here", () => {
    const api = read("../../api/src/classifieds/terms.service.ts");
    expect(api).toContain(`shopTermsVersion = '${legalVersion}'`);
    const path = api.match(/shopTermsPath = '([^']+)'/)?.[1];
    expect(path).toBe("/legal/terms");
    expect(legalDocuments.some(doc => `/legal/${doc.slug}` === path)).toBe(true);
    // The accept prompt links the API's path, and only a legal page on this site.
    expect(termsHref({ version: legalVersion, path: "/legal/terms", accepted: false, previous_version: null })).toBe("/legal/terms");
    expect(termsHref({ version: legalVersion, path: "https://evil.example/terms", accepted: false, previous_version: null })).toBe("/legal/terms");
    expect(termsHref(null)).toBe("/legal/terms");
  });

  test("the cookie notice names every udz_ cookie and storage key Udozo's sites set", () => {
    const named = JSON.stringify(legalDocuments.find(doc => doc.slug === "cookies")!.sections);
    const sources = [read("../lib/customer.ts"), read("../lib/assistant.ts"), read("../components/assistant.tsx"), read("../../verify/lib/brand.ts"), read("../../api/src/products/product.ts")].join("\n");
    const set = new Set([...sources.matchAll(/["'](udz_[a-z_]+)["']/g)].map(match => match[1]));
    expect([...set].sort()).toEqual(["udz_admin_session", "udz_assistant", "udz_assistant_language", "udz_customer", "udz_kyc", "udz_session"]);
    for (const name of set) expect(named, `${name} is in the cookie notice`).toContain(name);
    // Seller HQ's own browser storage, and the shared install reminders.
    const shq = [read("../../udozo-shq/components/reseller.tsx"), read("../../udozo-shq/app/(console)/page.tsx")].join("\n");
    for (const key of [...shq.matchAll(/["`](udozo-shq[a-z.-]*)/g)].map(match => match[1].replace(/\.$/, ""))) expect(named, `${key} is in the cookie notice`).toContain(key);
    for (const key of ["bc_install", "bc_install_visit", "assistant:draft:"]) expect(named).toContain(key);
    // Udozo never sets BitoCard's cross-site sign-in cookie.
    expect(named).not.toContain("bc_signed_in");
  });

  test("the identity check's consent links the privacy notice's section, as verify.udozo.com does", async () => {
    expect(read("../components/account-forms.tsx")).toContain('href="/legal/privacy#identity-checks"');
    expect(read("../../verify/lib/brand.ts")).toContain('privacyUrl: "https://udozo.com/legal/privacy"');
    const html = await documentHtml("privacy");
    expect(html).toContain('id="identity-checks"');
    expect(html).toContain("biometric data");
    for (const authority of ["NDPC", "DPC", "ODPC", "Anthropic", "OpenAI", "Neon", "DigitalOcean", "Upstash", "Vercel", "Cloudflare", "Paystack", "Flutterwave", "pawaPay", "Stripe"]) expect(html).toContain(authority);
  });

  test("Seller HQ's sign-up links the seller terms and the terms of use on udozo.com", () => {
    const page = read("../../udozo-shq/app/signup/page.tsx");
    for (const slug of ["sellers", "terms", "privacy"]) expect(page).toContain(`"https://udozo.com/legal/${slug}"`);
    expect(page).not.toContain("seller-terms");
  });

  test("the footer and the sitemap list the documents", async () => {
    const footer = render(createElement(SiteFooter));
    for (const slug of ["terms", "safe-pay", "sellers", "privacy", "cookies"]) expect(footer).toContain(`href="/legal/${slug}"`);
    expect(footer).not.toContain("legals.bitocard.com");
    const xml = await (await sitemapMain()).text();
    expect(xml).toContain("<loc>https://udozo.com/legal</loc>");
    for (const doc of legalDocuments) expect(xml).toContain(`<loc>https://udozo.com/legal/${doc.slug}</loc>`);
  });
});
