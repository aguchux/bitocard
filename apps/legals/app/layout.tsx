import type { Metadata, Viewport } from "next";
import { appUrl, brand, siteUrl } from "@bitocard/ui/site";
import { languageAlternates, ogImage, siteName } from "@/components/seo";
import "./globals.css";
import "@bitocard/ui/styles/workspace.css";
import "@bitocard/ui/styles/brand-lockup.css";
import "./landing.css";

const title = "BitoCard Legals & Compliance – privacy, terms and cookies";
const description = "BitoCard's privacy notice, terms of use, cookie notice and company information for resellers and customers in Europe, the Americas, Africa and Asia.";

// Favicons are app/favicon.ico, icon.svg, icon1.png and apple-icon.png (scripts/brand-assets.py); banner images from app/og/[image]/route.tsx.
export const metadata: Metadata = {
  metadataBase: siteUrl(3005),
  title: { default: title, template: `%s | ${siteName}` },
  description,
  applicationName: siteName,
  authors: [{ name: `${brand.name} Legal`, url: appUrl("legals") }],
  creator: brand.name,
  publisher: brand.name,
  keywords: ["BitoCard privacy notice", "BitoCard terms of use", "BitoCard cookie notice", "BitoCard legal notice", "GDPR", "UK GDPR", "CCPA", "PIPEDA", "NDPA", "POPIA", "DPDP Act", "privacy rights"],
  category: "legal",
  alternates: { canonical: "/", languages: languageAlternates("/") },
  openGraph: { type: "website", url: "/", siteName, title, description, locale: "en_GB", images: [ogImage("/")] },
  twitter: { card: "summary_large_image", title, description, images: [ogImage("/")] },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
  referrer: "strict-origin-when-cross-origin",
};

export const viewport: Viewport = { themeColor: "#fcfdff", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
