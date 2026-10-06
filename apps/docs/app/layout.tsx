import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Brand } from "@bitocard/ui/brand";
import { brand, siteUrl } from "@bitocard/ui/site";
import { AccountControls, LiveBanner } from "@/components/account-controls";
import { Search } from "@/components/search";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { TryItProvider } from "@/components/try-it-context";
import { navigation, searchIndex } from "@/lib/nav";
import "@bitocard/ui/styles/brand-lockup.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const title = "BitoCard API documentation";
const description = "Build on BitoCard: sell gift cards, airtime, data, bills and more from your own systems. Guides, the full API reference, webhooks and a sandbox for every reseller.";

export const metadata: Metadata = {
  metadataBase: siteUrl(3002),
  title: { default: title, template: "%s | BitoCard API" },
  description,
  applicationName: `${brand.name} Docs`,
  alternates: { canonical: "/" },
  openGraph: { type: "website", url: "/", siteName: `${brand.name} Docs`, title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const groups = navigation();
  const index = await searchIndex();
  return (
    <html lang="en-GB" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-white font-sans text-slate-800 antialiased">
        <TryItProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
            Skip to content
          </a>
          <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-4 sm:px-6">
              <MobileNav groups={groups} />
              <Link href="/" className="wordmark inline-flex shrink-0 items-center gap-2 text-[21px] font-extrabold sm:text-[24px] tracking-tight text-[#070f4c] no-underline" aria-label="BitoCard API documentation home">
                <Brand />
                <span className="hidden rounded-md bg-[#070f4c] px-1.5 py-0.5 text-xs font-bold tracking-wide text-white sm:inline">DOCS</span>
              </Link>
              <div className="flex min-w-0 flex-1 justify-end md:justify-center">
                <Search index={index} />
              </div>
              <AccountControls />
            </div>
          </header>
          <LiveBanner />
          <div className="mx-auto flex max-w-[1440px]">
            <Sidebar groups={groups} />
            <main id="main" className="min-w-0 flex-1 px-4 pt-8 pb-24 sm:px-8 lg:px-12">
              {children}
            </main>
          </div>
          <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
            {brand.credit} ·{" "}
            <a href="https://shq.bitocard.com" className="hover:text-[#070f4c]">
              SHQ
            </a>{" "}
            ·{" "}
            <a href="https://legals.bitocard.com/documents/terms" className="hover:text-[#070f4c]">
              Terms
            </a>
          </footer>
        </TryItProvider>
      </body>
    </html>
  );
}
