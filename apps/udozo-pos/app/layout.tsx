import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const grotesk = Space_Grotesk({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-space-grotesk", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://pos.udozo.com"),
  title: { default: "Udozo POS: the till that knows your Udozo stock", template: "%s | Udozo POS" },
  description: "A point of sale for udozo.com sellers with a physical shop. Sell in the shop from the same stock you list on Udozo, with staff, receipts and reports.",
  applicationName: "Udozo POS",
};

export const viewport: Viewport = { themeColor: "#10231C", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${grotesk.variable}`}>
      {/* Browser extensions add attributes to <body> before React loads. */}
      <body className="flex min-h-svh flex-col font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
