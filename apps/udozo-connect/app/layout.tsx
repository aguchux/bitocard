import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://connect.udozo.com"),
  title: { default: "Udozo Connect", template: "%s | Udozo Connect" },
  description: "Apply to run a Udozo Connect Centre: an office that receives items from sellers and hands them to buyers.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#185174", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      {/* Browser extensions add attributes to <body> before React loads. */}
      <body className="flex min-h-svh flex-col font-sans antialiased" suppressHydrationWarning>
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
