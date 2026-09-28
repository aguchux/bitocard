import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "BitoCard | Reseller workspace", description: "Your future home for managing your BitoCard store.", icons: { icon: "/bitocard-logo.png" }, robots: { index: false, follow: false } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
