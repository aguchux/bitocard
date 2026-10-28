import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToReadableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/navigation", async original => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined }), usePathname: () => "/legal" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, unstable_cache: (fn: () => unknown) => fn }));

const { legalDocuments, legalVersion } = await import("@/lib/legal");
const { default: LegalPage } = await import("@/app/legal/page");
const { default: DocumentPage, generateStaticParams } = await import("@/app/legal/[doc]/page");
const { default: sitemap } = await import("@/app/sitemap");

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

async function render(element: Promise<React.ReactElement> | React.ReactElement) {
  const stream = await renderToReadableStream(await element);
  await stream.allReady;
  return (await new Response(stream).text()).replaceAll("<!-- -->", "");
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ object: "list", data: [] }), { headers: { "content-type": "application/json" } })));
  vi.stubEnv("API_URL", "http://api.test");
  vi.stubEnv("AFRIPPA_SERVER_SECRET", "afrippa-site-secret-afrippa-site-secret-ab");
  setRequest({ "x-real-ip": "203.0.113.7" }, {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Afrippa's legal documents", () => {
  test("every document has its page, a draft notice, contents and anchored sections; the hub lists them all", async () => {
    expect(generateStaticParams().map(item => item.doc)).toEqual(["terms", "p2p-rules", "fees", "risks", "privacy", "cookies"]);
    const hub = await render(LegalPage());
    for (const doc of legalDocuments) {
      expect(hub).toContain(`href="/legal/${doc.slug}"`);
      const html = await render(DocumentPage({ params: Promise.resolve({ doc: doc.slug }) }));
      expect(html).toContain(doc.title);
      expect(html).toContain("Draft for lawyers&#x27; review.");
      expect(html).toContain(`Version ${legalVersion}`);
      for (const section of doc.sections) expect(html).toContain(`id="${section.id}"`);
      expect(new Set(doc.sections.map(section => section.id)).size).toBe(doc.sections.length);
    }
  });

  test("the version traders accept is the API's, and the documents they accept exist", () => {
    const api = read("../../api/src/crypto/crypto-wallets.service.ts");
    expect(api).toContain(`cryptoDeclarationVersion = '${legalVersion}'`);
    for (const path of [...api.matchAll(/path: '(\/legal\/[a-z0-9-]+)'/g)].map(match => match[1])) {
      expect(legalDocuments.some(doc => `/legal/${doc.slug}` === path)).toBe(true);
    }
    const views = read("../../../packages/afrippa-ui/src/trade-views.tsx");
    for (const slug of ["terms", "p2p-rules", "risks"]) expect(views).toContain(`"/legal/${slug}"`);
  });

  test("the cookie notice names every cookie Afrippa's sites set", () => {
    const cookies = legalDocuments.find(doc => doc.slug === "cookies")!;
    const named = JSON.stringify(cookies.sections);
    const sources = [read("../lib/customer.ts"), read("../lib/google.ts"), read("../lib/chat-types.ts"), read("../lib/device.ts"), read("../proxy.ts"), read("../../verify/lib/brand.ts")].join("\n");
    const set = new Set([...sources.matchAll(/["'](afr_[a-z_]+)["']/g)].map(match => match[1]));
    expect(set.size).toBeGreaterThanOrEqual(5);
    for (const name of set) expect(named, `${name} is in the cookie notice`).toContain(name);
  });

  test("the privacy notice's identity-check section is what the check's consent links to", async () => {
    expect(read("../components/verification.tsx")).toContain('href="/legal/privacy#identity-checks"');
    expect(read("../../verify/lib/brand.ts")).toContain('privacyUrl: "https://afrippa.com/legal/privacy"');
    const html = await render(DocumentPage({ params: Promise.resolve({ doc: "privacy" }) }));
    expect(html).toContain('id="identity-checks"');
    expect(html).toContain("biometric data");
  });

  test("the sitemap lists the documents", async () => {
    const urls = (await sitemap()).map(item => new URL(item.url).pathname);
    for (const doc of legalDocuments) expect(urls).toContain(`/legal/${doc.slug}`);
    expect(urls).toContain("/legal");
  });
});
