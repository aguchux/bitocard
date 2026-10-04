import type { Metadata, Viewport } from "next";
import { brand, siteUrl } from "@bitocard/ui/site";
import "@bitocard/ui/styles/brand-lockup.css";
import "./globals.css";

const title = "BitoCard – Gift cards, airtime, data, bills and more";
const description = "Shop digital gift cards, top up mobile airtime and data, pay bills and TV, and explore eSIMs and software, delivered digitally. Or open your own reseller store.";

export const metadata: Metadata = {
  metadataBase: siteUrl(3000),
  title: { default: title, template: "%s | BitoCard" },
  description,
  applicationName: brand.name,
  keywords: ["gift cards", "buy gift cards online", "airtime top up", "mobile data", "pay bills online", "eSIM", "digital store", "gift card reseller", "BitoCard"],
  category: "shopping",
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: brand.name, title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: "#fcfdff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
