import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { appUrl, brand } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";
import { InstallSupport } from "@bitocard/ui/install-ui";
import { installCaptureScript } from "@bitocard/ui/install";
import "./globals.css";

// Loaded once, on <html>: `font-sans` and `font-display` (the shared tokens) read it as --font-inter.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const title = "BitoCard Shop – Buy and sell near you, protected by Safe pay";
const description = "Buy and sell phones, cars, property, electronics and more near you. Chat with sellers, and pay with Safe pay: BitoCard holds the money until you have the item.";

export const metadata: Metadata = {
  // Canonical addresses, sitemaps and Open Graph images always name shop.bitocard.com (SHOP_URL), previews included.
  metadataBase: new URL(appUrl("shop")),
  title: { default: title, template: "%s | BitoCard Shop" },
  description,
  applicationName: "BitoCard Shop",
  category: "shopping",
  openGraph: { type: "website", siteName: "BitoCard Shop", title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
  other: { "application-name": brand.name },
};

export const viewport: Viewport = { themeColor: colors.navy900 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
      </head>
      <body className="min-h-dvh overflow-x-clip font-sans">
        {children}
        <InstallSupport />
      </body>
    </html>
  );
}
