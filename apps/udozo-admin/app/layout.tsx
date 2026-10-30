import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@bitocard/admin-ui/shell";
import { UdozoApiProduct } from "./api-product";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://admin.udozo.com"),
  title: { default: "Udozo Admin", template: "%s | Udozo Admin" },
  description: "Udozo's operations: the marketplace, sellers and resellers, Safe pay, plans and fees, theme and settings.",
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
