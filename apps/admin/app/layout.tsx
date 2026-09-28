import type { Metadata } from "next";
import { brand, siteUrl } from "@bitocard/ui/site";
import "./globals.css";
import "@bitocard/ui/styles/workspace.css";

export const metadata: Metadata = {
  metadataBase: siteUrl(3003),
  title: "BitoCard | Administration",
  description: "The future workspace for BitoCard platform operators.",
  icons: { icon: brand.logo },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
