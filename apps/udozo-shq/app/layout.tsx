import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@bitocard/admin-ui/shell";
import { UdozoApiProduct } from "./api-product";
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
      <body className="min-h-svh antialiased" suppressHydrationWarning>
        <UdozoApiProduct>
          <AppProviders>{children}</AppProviders>
        </UdozoApiProduct>
      </body>
    </html>
  );
}
