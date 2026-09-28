import type { Metadata, Viewport } from "next";
import { brand, siteUrl } from "@bitocard/ui/site";
import "@bitocard/ui/styles/brand-lockup.css";
import "./globals.css";

const title = "BitoCard – Launch your own gift card, airtime & data store";
const description = "Build your own branded store for digital gift cards, mobile airtime and data. Choose your products, set your prices and grow your reseller business with BitoCard.";

export const metadata: Metadata = {
  metadataBase: siteUrl(3000),
  title: { default: title, template: "%s | BitoCard" },
  description,
  applicationName: brand.name,
  keywords: ["gift card reseller", "digital gift card store", "airtime reseller", "data bundle reseller", "white-label storefront", "reseller platform", "BitoCard"],
  category: "business",
  alternates: { canonical: "/" },
  icons: { icon: brand.logo, apple: brand.logo },
  openGraph: { type: "website", url: "/", siteName: brand.name, title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: "#fcfdff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
