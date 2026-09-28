import type { Metadata, Viewport } from "next";
import { brand, siteUrl } from "@bitocard/ui/site";
import { siteName } from "@/components/seo";
import "./globals.css";
import "@bitocard/ui/styles/workspace.css";
import "@bitocard/ui/styles/brand-lockup.css";
import "./landing.css";

const title = "BitoCard Legals & Compliance – privacy, terms and cookies";
const description = "BitoCard's privacy notice, terms of use, cookie notice and company information for resellers and customers in Europe, the Americas, Africa and Asia.";

export const metadata: Metadata = {
  metadataBase: siteUrl(3005),
  title: { default: title, template: `%s | ${siteName}` },
  description,
  applicationName: siteName,
  keywords: ["BitoCard privacy notice", "BitoCard terms of use", "BitoCard cookies", "GDPR", "CCPA", "PIPEDA", "NDPA", "POPIA", "DPDP Act"],
  category: "legal",
  alternates: { canonical: "/" },
  icons: { icon: brand.logo, apple: brand.logo },
  openGraph: { type: "website", url: "/", siteName, title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: "#fcfdff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
