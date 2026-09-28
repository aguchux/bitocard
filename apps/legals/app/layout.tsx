import type { Metadata, Viewport } from "next";
import { brand, siteUrl } from "@bitocard/ui/site";
import "./globals.css";
import "@bitocard/ui/styles/workspace.css";
import "@bitocard/ui/styles/brand-lockup.css";
import "./landing.css";

const description = "Privacy, terms, cookies and company information for BitoCard in Europe, the Americas, Africa and Asia.";

export const metadata: Metadata = {
  metadataBase: siteUrl(3005),
  title: "BitoCard | Legals & Compliance",
  description,
  icons: { icon: brand.logo, apple: brand.logo },
  openGraph: { type: "website", siteName: brand.name, title: "BitoCard | Legals & Compliance", description, locale: "en_GB", images: [{ url: brand.logo, width: 1280, height: 1280, alt: brand.name }] },
  twitter: { card: "summary", title: "BitoCard | Legals & Compliance", description, images: [brand.logo] },
};

export const viewport: Viewport = { themeColor: "#fcfdff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
