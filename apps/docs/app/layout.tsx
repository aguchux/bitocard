import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "BitoCard | Documentation", description: "Guides for building your BitoCard business.", icons: { icon: "/bitocard-logo.png" }, robots: { index: false, follow: false } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
