import type { Metadata, Viewport } from "next";
import { brand, siteUrl } from "@bitocard/ui/site";
import "./globals.css";

const description = "A branded storefront for your digital goods business. BitoCard is coming soon. A Golojan Ltd venture.";

export const metadata: Metadata = {
  metadataBase: siteUrl(3000),
  title: "BitoCard | Coming soon",
  description,
  icons: { icon: brand.logo, apple: brand.logo },
  openGraph: { type: "website", siteName: brand.name, title: "BitoCard | Coming soon", description, locale: "en_GB", images: [{ url: brand.logo, width: 1280, height: 1280, alt: brand.name }] },
  twitter: { card: "summary", title: "BitoCard | Coming soon", description, images: [brand.logo] },
};

export const viewport: Viewport = { themeColor: "#fcfdff" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
