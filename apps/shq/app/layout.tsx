import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { installCaptureScript } from "@bitocard/ui/install";
import { InstallSupport } from "@bitocard/ui/install-ui";
import { siteUrl } from "@bitocard/ui/site";
import { Providers } from "@/components/providers";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: siteUrl(3004),
  title: { default: "BitoCard SHQ", template: "%s | BitoCard SHQ" },
  description: "Seller Head Quarters: run your BitoCard reseller business.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#070f4c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
      </head>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React loads. */}
      <body className="min-h-svh antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
        {/* SHQ's one service worker is its push worker, which also makes it installable. */}
        <InstallSupport worker="/push-sw.js" />
      </body>
    </html>
  );
}
