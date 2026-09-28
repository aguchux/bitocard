import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "BitoCard | Administration", description: "The future workspace for BitoCard platform operators.", icons: { icon: "/bitocard-logo.png" }, robots: { index: false, follow: false } };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en-GB"><body>{children}</body></html>;
}
