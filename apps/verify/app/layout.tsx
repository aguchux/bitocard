import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { siteUrl } from "@bitocard/ui/site";
import { brand } from "@/lib/brand";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: siteUrl(3006),
  title: { default: brand.product, template: `%s | ${brand.product}` },
  description: brand.description,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = { themeColor: "#070f4c", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React loads. */}
      <body className="min-h-svh bg-canvas antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
