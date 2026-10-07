import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { StoreFooter, StoreHeader } from "@/components/store/layout";
import { currentCustomer } from "@/lib/customer";
import { currentMarket } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";
import { currentStore, storeSubdomain } from "@/lib/store";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

/** On a reseller's store: its name in every title, and its own address as the canonical one. */
export async function generateMetadata(): Promise<Metadata> {
  const subdomain = await storeSubdomain();
  if (!subdomain) return {};
  const { store } = await currentStore();
  const name = store?.name ?? "Store";
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
 * reseller listed.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const { store, missing } = await currentStore();
  const shell = `${inter.variable} store min-h-svh overflow-x-clip bg-[#fcfdff] font-[family-name:var(--font-inter)] text-[#070f4c]`;
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
  const [{ groups, countries }, market, customer] = await Promise.all([storeNavigation(), currentMarket(), currentCustomer()]);
  return (
    <div className={shell}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2">
        Skip to content
      </a>
      {store?.checkout_mode === "test" ? (
        <p role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">
          Test store: orders are simulated and no money is taken.
        </p>
      ) : null}
      <StoreHeader groups={groups} countries={countries} market={market} signedIn={Boolean(customer)} store={store} />
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <StoreFooter groups={groups} store={store} />
    </div>
  );
}
