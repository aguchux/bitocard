import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { AppProviders } from "@bitocard/admin-ui/shell";
import { AfrippaAdminProduct } from "./admin-product";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AFRIPPA_ADMIN_URL ?? "https://admin.afrippa.com"),
  title: { default: "Afrippa Admin", template: "%s | Afrippa Admin" },
  description: "Afrippa's operations: orders and appeals, traders, crypto, help and settings.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#070f4c", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="min-h-svh antialiased" suppressHydrationWarning>
        <AfrippaAdminProduct>
          <AppProviders>{children}</AppProviders>
        </AfrippaAdminProduct>
      </body>
    </html>
  );
}
