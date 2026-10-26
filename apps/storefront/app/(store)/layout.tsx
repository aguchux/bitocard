import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import type { StoreApp } from "@bitocard/api-client/storefront";
import { InstallPrompt } from "@bitocard/ui/install-ui";
import { ChatWidget } from "@/components/app/chat-widget";
import { StoreFooter, StoreHeader } from "@/components/store/layout";
import { storeApi } from "@/lib/api";
import { currentCustomer } from "@/lib/customer";
import { countryStoreFor, currentMarket, marketIsGlobal } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";
import { currentStore, storeSubdomain } from "@/lib/store";
import { storeShell } from "@/lib/store-theme";

/**
 * On a reseller's store: its name in every title, and its own address as the canonical one. A market's own country
 * store is BitoCard's own, just localised: its own address as the canonical one, but the default BitoCard title,
 * name and description stand (set in the root layout), never a distinct "BitoCard NG" brand.
 */
export async function generateMetadata(): Promise<Metadata> {
  const subdomain = await storeSubdomain();
  if (!subdomain) return {};
  const { store } = await currentStore();
  if (!store || store.house) return { metadataBase: new URL(`https://${subdomain}.bitocard.com`) };
  const name = store.name;
  return {
    metadataBase: new URL(`https://${subdomain}.bitocard.com`),
    title: { absolute: name, template: `%s | ${name}` },
    description: `Gift cards, top-ups, bills and more from ${name}, delivered digitally.`,
    applicationName: name,
    openGraph: { siteName: name, title: name, url: "/" },
    twitter: { title: name },
  };
}

/**
 * The store's pages: header with the category menus, the page, and the footer. On a reseller's store
 * (`<subdomain>.bitocard.com`) the store's own name and logo replace BitoCard's, and its products are the ones the
 * reseller listed. A market's own country store (`ng.bitocard.com`…) is BitoCard's own retail arm there: it wears
 * BitoCard's own name, logo and theme throughout, never rebranded, with only its market restricted.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { store, missing } = await currentStore();
  const shell = "store flex min-h-svh flex-col overflow-x-clip bg-page text-navy-900";
  if (missing) {
    return (
      <div className={shell}>
        <main id="main" className="mx-auto grid min-h-svh max-w-xl place-content-center gap-3 px-4 text-center">
          <h1 className="font-display text-3xl font-extrabold tracking-tight">This store is not open</h1>
          <p className="text-slate-600">Check the address, or come back later.</p>
        </main>
      </div>
    );
  }
  const [{ groups, countries }, market, customer, global, app] = await Promise.all([
    storeNavigation(),
    currentMarket(),
    currentCustomer(),
    marketIsGlobal(),
    store ? store.app : storeApi<StoreApp>("/v1/store/app").then(result => (result.ok ? result.data : undefined)),
  ]);
  // On root (no store context at all), a signed-in customer whose fixed country now has its own live country store
  // belongs there: send them, rather than serving their market from root (docs/BITOCARD_COUNTRY_STORES_PLAN.md) —
  // unless they explicitly chose to stay global (the market dialog's "Stay global"), which is a standing choice,
  // not just for one visit.
  if (!store && !global) {
    const subdomain = countryStoreFor(countries, customer?.country);
    if (subdomain) redirect(`https://${subdomain}.bitocard.com`);
  }
  // A reseller's store wears its template's variant and colour theme; a market's own country store wears BitoCard's own.
  return (
    <div className={shell} {...storeShell(store && !store.house ? store.design : undefined)}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {store?.checkout_mode === "test" ? (
        <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">
          Test store: orders are simulated and no money is taken.
        </p>
      ) : null}
      <StoreHeader groups={groups} countries={countries} market={market} signedIn={Boolean(customer)} store={store} />
      <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <StoreFooter groups={groups} store={store} />
      {/* Chat with the store: signed-in customers as themselves, visitors after giving their name and email (?chat=1 opens it). */}
      <Suspense fallback={null}>
        <ChatWidget store={store && !store.house ? store.name : "BitoCard"} />
      </Suspense>
      {/* bitocard.com and its country stores ask to be installed as an app where an admin switched it on; resellers' stores never. */}
      <InstallPrompt enabled={app?.install_prompt === true} appName="BitoCard" />
    </div>
  );
}
