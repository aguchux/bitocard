import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import { appUrl } from "@bitocard/ui/site";
import { colors } from "@bitocard/ui/tokens";
import { InstallSupport } from "@bitocard/ui/install-ui";
import { installCaptureScript } from "@bitocard/ui/install";
import { CryptoActionsProvider } from "@afrippa/ui/forms";
import { MoneyActionsProvider } from "@afrippa/ui/money-forms";
import { changeAd, chooseNickname, postAd, repriceAd } from "@/lib/trade";
import { legalDocuments } from "@/lib/legal";
import { addWithdrawalAddress, cancelWithdrawal, confirmWithdrawal, createWithdrawal, removeWithdrawalAddress, resendWithdrawalCode, reviewWithdrawal } from "@/lib/money";
import "./globals.css";

// Loaded once, on <html>: `font-sans` and `font-display` (the shared tokens) read it as --font-inter.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const title = "Afrippa – Buy and sell crypto with people";
const description = "Buy and sell USDT, BTC and more with other people, in your country's currency or US dollars. Paid directly to each other, the coins held until the seller is paid.";

export const metadata: Metadata = {
  // Canonical addresses and sitemaps always name afrippa.com (AFRIPPA_URL), previews included.
  metadataBase: new URL(appUrl("afrippa")),
  title: { default: title, template: "%s | Afrippa" },
  description,
  applicationName: "Afrippa",
  category: "finance",
  openGraph: { type: "website", siteName: "Afrippa", title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = { themeColor: colors.navy900 };

/** The footer: who runs Afrippa, and its legal documents. */
function Footer() {
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500 sm:px-6">
        <p>© {new Date().getFullYear()} Afrippa · A Golojan Ltd venture</p>
        <nav aria-label="Legal">
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {legalDocuments.map(doc => (
              <li key={doc.slug}>
                <Link href={`/legal/${doc.slug}`} className="hover:text-navy-900">
                  {doc.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB" className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
      </head>
      <body className="min-h-dvh overflow-x-clip font-sans">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
          Skip to content
        </a>
        {/* The shared trading and money forms act through this site's own server actions and pages. */}
        <CryptoActionsProvider actions={{ postAd, repriceAd, changeAd, chooseNickname }} links={{ postAd: "/ads/post" }}>
          <MoneyActionsProvider
            actions={{ addWithdrawalAddress, removeWithdrawalAddress, reviewWithdrawal, createWithdrawal, confirmWithdrawal, resendWithdrawalCode, cancelWithdrawal }}
          >{children}</MoneyActionsProvider>
        </CryptoActionsProvider>
        <Footer />
        <InstallSupport />
      </body>
    </html>
  );
}
