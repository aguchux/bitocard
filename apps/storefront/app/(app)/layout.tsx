import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { StoreApp } from "@bitocard/api-client/storefront";
import { Brand } from "@bitocard/ui/brand";
import { brand } from "@bitocard/ui/site";
import { AppHeader } from "@/components/app/app-header";
import { AppNav, AppRail } from "@/components/app/app-nav";
import { StoreName } from "@/components/store/layout";
import { storeApi } from "@/lib/api";
import { currentCustomer, safeNext } from "@/lib/customer";
import { pathHeader } from "@/lib/path-header";
import { currentStore, storeSubdomain } from "@/lib/store";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export async function generateMetadata(): Promise<Metadata> {
  const subdomain = await storeSubdomain();
  const { store } = await currentStore();
  const name = store?.name ?? brand.name;
  return {
    ...(subdomain ? { metadataBase: new URL(`https://${subdomain}.bitocard.com`) } : {}),
    title: { absolute: `Your account | ${name}`, template: `%s | ${name}` },
    robots: { index: false, follow: false },
  };
}

/**
 * The customer account app (signed-in customers only): a header with the store's brand, search and menu; the four
 * tabs (Home, Catalog, Orders, Account) as a bottom bar on phones and tablets and, on desktop, a side rail or the same
 * bottom bar as the store (or BitoCard) chose; and a footer with only the copyright line.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ store, missing }, customer] = await Promise.all([currentStore(), currentCustomer()]);
  const shell = `${inter.variable} min-h-svh overflow-x-clip bg-white font-[family-name:var(--font-inter)] text-[#070f4c]`;
  if (missing) {
    return (
      <div className={shell}>
        <main id="main" className="mx-auto grid min-h-svh max-w-xl place-content-center gap-3 px-4 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight">This store is not open</h1>
          <p className="text-slate-600">Check the address, or come back later.</p>
        </main>
      </div>
    );
  }
  // Back to the page asked for after signing in (the proxy passes its path; only local paths are followed).
  const next = encodeURIComponent(safeNext((await headers()).get(pathHeader), "/account"));
  if (!customer) redirect(`/signin?next=${next}`);
  if (!customer.email_verified) redirect(`/account/verify?next=${next}`);

  // The store's choice (else BitoCard's default); the side rail if the API cannot be reached.
  const app = store ? store.app : await storeApi<StoreApp>("/v1/store/app").then(result => (result.ok ? result.data : undefined));
  const desktopNav: "rail" | "bottom" = app?.desktop_nav === "bottom" ? "bottom" : "rail";
  const rail = desktopNav === "rail";
  const name = store?.name ?? brand.name;
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
      <AppHeader
        storeName={name}
        brand={
          store ? (
            <StoreName store={store} />
          ) : (
            <span className="wordmark inline-flex items-center gap-2 text-[26px] font-extrabold tracking-tight text-[#070f4c] sm:text-[30px]">
              <Brand />
            </span>
          )
        }
      />
      <AppNav desktopNav={desktopNav} />
      <div className={rail ? "lg:flex" : undefined}>
        {rail ? <AppRail /> : null}
        <div className={`min-w-0 flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] ${rail ? "lg:pb-0" : ""}`}>
          <main id="main" className="mx-auto w-full max-w-6xl px-4 pt-5 pb-8 sm:px-6 sm:pt-8 lg:px-8">
            {children}
          </main>
          <footer className="px-4 pb-6 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} {name} · {brand.credit}
          </footer>
        </div>
      </div>
    </div>
  );
}
