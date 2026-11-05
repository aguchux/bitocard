import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@bitocard/admin-ui/shell";
import { consoleThemeCss, udozoConsoleColors } from "@bitocard/admin-ui/theme";
import { UdozoApiProduct } from "./api-product";
import { UdozoTheme } from "@/components/admin-theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://admin.udozo.com"),
  title: { default: "Udozo Admin", template: "%s | Udozo Admin" },
  description: "Udozo's operations: the marketplace, sellers and resellers, Safe pay, plans and fees, theme and settings.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: udozoConsoleColors.primary, width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <head>
        {/* Udozo's logo colours from the first paint; the published theme replaces them once it loads (UdozoTheme). */}
        <style dangerouslySetInnerHTML={{ __html: consoleThemeCss(udozoConsoleColors) }} />
      </head>
      <body className="min-h-svh antialiased" suppressHydrationWarning>
        <UdozoApiProduct>
          <AppProviders>
            <UdozoTheme />
            {children}
          </AppProviders>
        </UdozoApiProduct>
      </body>
    </html>
  );
}
