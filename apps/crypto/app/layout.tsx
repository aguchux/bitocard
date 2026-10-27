import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl, brand } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";
import "./globals.css";

// Loaded once, on <html>: `font-sans` and `font-display` (the shared tokens) read it as --font-inter.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const title = "BitoCard Crypto – Buy and sell crypto with people";
const description = "Buy and sell USDT, BTC and more with other people, in your country's currency or US dollars. Instant trades paid from BitoCard wallets.";

export const metadata: Metadata = {
  // Canonical addresses and sitemaps always name crypto.bitocard.com (CRYPTO_URL), previews included.
  metadataBase: new URL(appUrl("crypto")),
  title: { default: title, template: "%s | BitoCard Crypto" },
  description,
  applicationName: "BitoCard Crypto",
  category: "finance",
  openGraph: { type: "website", siteName: "BitoCard Crypto", title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, email: false, address: false },
  other: { "application-name": brand.name },
};

export const viewport: Viewport = { themeColor: colors.navy900 };

/** The footer: who runs BitoCard and its legal documents. */
function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500 sm:px-6">
        <p>© {new Date().getFullYear()} BitoCard · A Golojan Ltd venture</p>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          {legalDocuments
            .filter(doc => ["terms", "privacy", "cookies"].some(slug => doc.href.endsWith(`/${slug}`)))
            .map(doc => (
              <a key={doc.href} href={appUrl("legals", doc.href)} className="hover:text-navy-900">
                {doc.label}
              </a>
            ))}
        </nav>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <body className="min-h-dvh overflow-x-clip font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        {children}
        <Footer />
      </body>
    </html>
  );
}
