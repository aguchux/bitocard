/* eslint-disable @next/next/no-img-element -- the store's own logo, from Udozo's storage at its own size */
import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { currentCustomer, safeNext, siteOrigin } from "@/lib/customer";
import { signOut } from "@/lib/account-actions";
import { requireStore, storeOrigin } from "@/lib/store";
import { indexable, storePathHeader } from "@/lib/store-host";
import { storeShell } from "@/lib/store-theme";

type Props = { children: React.ReactNode; params: Promise<{ store: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const store = await requireStore((await params).store);
  const origin = (await storeOrigin()) ?? siteOrigin();
  const description = `${store.name}: shop items from Udozo's sellers. Your payment is held by Udozo until you have the item.`;
  const index = indexable(store, origin, siteOrigin());
  return {
    // The store's own address, so canonical links and images name it, never udozo.com.
    metadataBase: new URL(origin),
    // The store's own name, never "| Udozo" after it (`absolute` leaves the root's template out).
    title: { absolute: store.name, template: `%s | ${store.name}` },
    description,
    applicationName: store.name,
    icons: store.branding.logo_url ? { icon: store.branding.logo_url, apple: store.branding.logo_url } : undefined,
    openGraph: { type: "website", siteName: store.name, title: store.name, description, locale: "en_GB" },
    twitter: { card: "summary_large_image", title: store.name, description },
    // Only a live store on its own domain is indexed; sandbox addresses are for testing.
    robots: index ? { index: true, follow: true } : { index: false, follow: false },
  };
}

/**
 * A reseller's store (docs/UDOZO_SPINOFF_PLAN.md, step 4), reached at its sandbox subdomain or its own domain: its name,
 * logo and design (the template's variant and colours re-point the theme's variables, `storeShell`), a notice while it
 * is a test store, signing in with the shopper's Udozo account (through udozo.com), and a footer saying who does what.
 */
export default async function StoreLayout({ children, params }: Props) {
  const store = await requireStore((await params).store);
  const [customer, path] = await Promise.all([currentCustomer(), headers().then(list => safeNext(list.get(storePathHeader), "/"))]);
  const site = siteOrigin();
  const logo = store.branding.logo_url;
  return (
    <div {...storeShell(store.design)} className="flex min-h-dvh flex-col bg-background text-navy-900">
      {store.checkout_mode === "test" ? (
        <p role="status" className="bg-amber-100 px-4 py-1.5 text-center text-sm font-semibold text-amber-950">
          Test store: orders here are practice only, and no real money moves.
        </p>
      ) : null}
      {customer && !customer.email_verified ? (
        <p role="status" className="bg-brand-50 px-4 py-1.5 text-center text-sm text-navy-900">
          Confirm your email to buy.{" "}
          <a href={`${site}/verify`} className="font-semibold underline">
            Confirm it on Udozo
          </a>
        </p>
      ) : null}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <Link href="/" className="font-display flex min-w-0 items-center gap-2.5 text-lg font-extrabold tracking-tight">
            {logo ? <img src={logo} alt="" className="size-9 shrink-0 rounded-lg object-contain" /> : null}
            <span className="truncate" style={store.branding.primary_color ? { color: store.branding.primary_color } : undefined}>
              {store.name}
            </span>
          </Link>
          <nav aria-label="Store" className="ml-auto flex shrink-0 items-center gap-1 text-sm font-semibold">
            <Link href="/listings" className="inline-flex min-h-10 items-center rounded-lg px-3 hover:bg-slate-100">
              Shop everything
            </Link>
            {customer ? (
              <>
                <Link href="/account/purchases" className="inline-flex min-h-10 items-center rounded-lg px-3 hover:bg-slate-100">
                  Your orders
                </Link>
                <form action={signOut} className="hidden sm:block">
                  <button type="submit" className="inline-flex min-h-10 items-center rounded-lg px-3 text-slate-600 hover:bg-slate-100">
                    Sign out
                  </button>
                </form>
              </>
            ) : (
              <a href={`/signin?next=${encodeURIComponent(path)}`} className="inline-flex min-h-10 items-center rounded-lg bg-navy-900 px-4 text-white hover:bg-navy-700">
                Sign in
              </a>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-[1400px] gap-2 px-4 py-6 text-sm text-slate-600 sm:px-6 lg:px-8">
          <p>
            {store.name} sells items from Udozo&apos;s sellers, each named on its page. Udozo holds your payment until you have the item.
          </p>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <a href={`${site}/account`} className="font-semibold hover:underline">
              Your Udozo account
            </a>
            <a href={`${site}/safe-trade`} className="font-semibold hover:underline">
              Safe trade guide
            </a>
            <a href={site} className="hover:underline">
              Powered by Udozo
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
