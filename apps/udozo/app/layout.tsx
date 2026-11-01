import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies, headers } from "next/headers";
import { InstallSupport } from "@bitocard/ui/install-ui";
import { installCaptureScript } from "@bitocard/ui/install";
import { CallProvider } from "@/components/calls/call-provider";
import { ChatDock } from "@/components/chat-dock";
import { CookieConsent } from "@/components/cookie-consent";
import { customerCookie, siteOrigin } from "@/lib/customer";
import { storeHeader } from "@/lib/store-host";
import { previewHeader, siteTheme, themeCss } from "@/lib/theme";
import "./globals.css";

// Loaded once, on <html>: `font-sans` and `font-display` (the shared tokens) read it as --font-inter.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const title = "Udozo – Buy and sell near you, protected by Safe pay";
const description = "Buy and sell phones, cars, property, electronics and more near you. Chat with sellers, and pay with Safe pay: Udozo holds the money until you have the item.";

export const metadata: Metadata = {
  // Canonical addresses, sitemaps and Open Graph images always name udozo.com (UDOZO_URL), previews included.
  metadataBase: new URL(siteOrigin()),
  title: { default: title, template: "%s | Udozo" },
  description,
  applicationName: "Udozo",
  category: "shopping",
  openGraph: { type: "website", siteName: "Udozo", title, description, locale: "en_GB" },
  twitter: { card: "summary_large_image", title, description },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  formatDetection: { telephone: false, email: false, address: false },
  appleWebApp: { capable: true, title: "Udozo", statusBarStyle: "default" },
  // Search Console and Bing Webmaster Tools ownership, set in the environment once the sites are added there.
  verification: {
    ...(process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : {}),
    ...(process.env.BING_SITE_VERIFICATION ? { other: { "msvalidate.01": process.env.BING_SITE_VERIFICATION } } : {}),
  },
};

/** The browser's bar follows the theme's primary colour. */
export async function generateViewport(): Promise<Viewport> {
  const theme = await siteTheme();
  return { themeColor: theme.colors.primary };
}

/**
 * Every page wears Udozo's theme, chosen by its admins (`/v1/theme`): its colours re-point the variables every utility
 * reads. `?theme_preview=<token>` on any address (the admins' preview link; the proxy passes it on) shows the draft.
 * A signed-in customer on udozo.com (never a reseller's store) can call and be called on every page (`CallProvider`), and
 * has their chats at hand (`ChatDock`). Every page asks for cookie consent until the visitor chooses (`CookieConsent`).
 */
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const list = await headers();
  const theme = await siteTheme(list.get(previewHeader));
  const onStore = Boolean(list.get(storeHeader));
  const calls = !onStore && (await cookies()).has(customerCookie);
  return (
    <html lang="en-GB" className={inter.variable} data-theme-preview={theme.preview ? "" : undefined}>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss(theme.colors) }} />
        <script dangerouslySetInnerHTML={{ __html: installCaptureScript }} />
      </head>
      <body className="min-h-dvh overflow-x-clip font-sans">
        {theme.preview ? (
          <p role="status" className="bg-brand-500 px-4 py-1.5 text-center text-sm font-semibold text-white">
            Theme preview: what you see is the draft, not yet published.
          </p>
        ) : null}
        {calls ? (
          <CallProvider>
            {children}
            <ChatDock />
          </CallProvider>
        ) : (
          children
        )}
        <InstallSupport />
        {/* A reseller's store has no legal pages of its own: its banner links udozo.com's cookie notice. */}
        <CookieConsent noticeHref={onStore ? `${siteOrigin()}/legal/cookies` : "/legal/cookies"} />
      </body>
    </html>
  );
}
