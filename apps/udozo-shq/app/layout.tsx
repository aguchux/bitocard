import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@bitocard/admin-ui/shell";
import { installCaptureScript } from "@bitocard/ui/install";
import { InstallSupport } from "@bitocard/ui/install-ui";
import { UdozoApiProduct } from "./api-product";
import { UdozoTheme } from "@/components/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://shq.udozo.com"),
  title: { default: "Udozo Seller HQ", template: "%s | Udozo Seller HQ" },
  description: "Udozo's Seller HQ: stores, resale listings, orders, domains, Premium, wallet and payouts.",
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
        <UdozoApiProduct>
          <AppProviders>
            <UdozoTheme />
            {children}
          </AppProviders>
        </UdozoApiProduct>
        {/* Seller HQ's one service worker is its push worker, which also makes it installable. */}
        <InstallSupport worker="/push-sw.js" />
      </body>
    </html>
  );
}
