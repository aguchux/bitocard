import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@bitocard/admin-ui/shell";
import { siteUrl } from "@bitocard/ui/site";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: siteUrl(3003),
  title: { default: "BitoCard Admin", template: "%s | BitoCard Admin" },
  description: "BitoCard platform administration.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#070f4c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React loads. */}
      <body className="min-h-svh antialiased" suppressHydrationWarning>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
