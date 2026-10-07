import { legalUpdated } from "@bitocard/ui/legal";
import { bannerOgImage, ogImageSize } from "@bitocard/ui/og-image";

export { ogImageSize };

const host = "legals.bitocard.com";
const updated = `Updated ${legalUpdated}`;

/** Banner social image per page, keyed by page path. Served at /og/<name>.png by app/og/[image]/route.tsx. */
export const ogPages = {
  "/": {
    alt: "BitoCard Legals & Compliance – plain-English legals for every region",
    crumbs: [host], eyebrow: "Legals & Compliance", title: "Plain-English legals.", accent: "For every region.",
    subtitle: "Privacy, terms, cookies and company details, in one place.",
    chips: ["UK & EU GDPR", "CCPA", "PIPEDA", "NDPA", "POPIA", "DPDP Act"],
  },
  "/documents": {
    alt: "BitoCard legal documents – every document in one place",
    crumbs: [host, "Documents"], eyebrow: updated, title: "Every document.", accent: "One place.",
    subtitle: "Privacy notice, terms of use, cookie notice and legal notice, kept up to date for every region.",
    chips: ["Privacy", "Terms", "Cookies", "Legal notice"],
  },
  "/documents/privacy": {
    alt: "BitoCard privacy notice – your privacy rights in every region",
    crumbs: [host, "Documents", "Privacy notice"], eyebrow: updated, title: "Privacy notice",
    subtitle: "How BitoCard handles personal information, and your rights under the law where you live.",
    chips: ["UK & EU GDPR", "US state laws", "PIPEDA", "NDPA", "POPIA", "DPDP Act"],
  },
  "/documents/terms": {
    alt: "BitoCard terms of use",
    crumbs: [host, "Documents", "Terms of use"], eyebrow: updated, title: "Terms of use",
    subtitle: "The rules for using BitoCard websites, and the law that applies where you are.",
    chips: ["Acceptable use", "Intellectual property", "Governing law"],
  },
  "/documents/cookies": {
    alt: "BitoCard cookie notice – only the cookies we need, consent first",
    crumbs: [host, "Documents", "Cookie notice"], eyebrow: updated, title: "Cookie notice",
    subtitle: "Only the cookies our sites need, never for tracking, and your consent first for anything optional.",
    chips: ["No tracking", "No analytics", "Consent first"],
  },
  "/documents/notice": {
    alt: "BitoCard legal notice – the companies behind BitoCard",
    crumbs: [host, "Documents", "Legal notice"], eyebrow: updated, title: "Legal notice",
    subtitle: "The Golojan group companies that operate BitoCard, and how to contact them.",
    chips: ["Delaware, USA", "England & Wales", "Nigeria"],
  },
  "/contact": {
    alt: "Contact BitoCard's legal and privacy team",
    crumbs: [host, "Contact"], eyebrow: "Legal & privacy team", title: "Talk to our", accent: "legal team.",
    subtitle: "Questions, privacy requests and security reports: one address for every region.",
    chips: ["legal@bitocard.com"],
  },
} satisfies Record<string, { alt: string; crumbs: string[]; eyebrow: string; title: string; accent?: string; subtitle: string; chips: string[] }>;

export type OgPath = keyof typeof ogPages;

/** Stable image file name for a page: "/" -> "home.png", "/documents/privacy" -> "privacy.png". */
export const ogFileName = (path: string) => `${path === "/" ? "home" : path.split("/").pop()}.png`;

export const ogPaths = Object.keys(ogPages) as OgPath[];

export const ogPathForFile = (file: string) => ogPaths.find(path => ogFileName(path) === file);

export function legalsOgImage(path: OgPath) {
  const page = ogPages[path];
  return bannerOgImage({
    tagline: "Legals & Compliance",
    crumbs: page.crumbs,
    eyebrow: page.eyebrow,
    title: page.title,
    accent: "accent" in page ? page.accent : undefined,
    subtitle: page.subtitle,
    chips: page.chips,
  });
}
