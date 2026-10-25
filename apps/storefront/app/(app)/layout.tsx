import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { nameInitials } from "@bitocard/api-client/classifieds";
import type { StoreApp } from "@bitocard/api-client/storefront";
import { Brand } from "@bitocard/ui/brand";
import { brand } from "@bitocard/ui/site";
import { AppHeader } from "@/components/app/app-header";
import { AppNav, AppRail } from "@/components/app/app-nav";
import { ChatWidget } from "@/components/app/chat-widget";
import { SubRail } from "@/components/app/sub-rail";
import { PublicSpinClaimDialog } from "@/components/app/public-spin-claim-dialog";
import { StoreName } from "@/components/store/layout";
import { storeApi } from "@/lib/api";
import { currentCustomer, customerApi, safeNext } from "@/lib/customer";
import { countryStoreFor, marketIsGlobal } from "@/lib/market";
import { storeNavigation } from "@/lib/navigation";
import { pathHeader } from "@/lib/path-header";
import { shopHref, shopMarketFor } from "@/lib/shop-server";
import { storeShell } from "@/lib/store-theme";
import { currentStore, storeCredit, storeSubdomain } from "@/lib/store";
import { pendingPublicSpinClaim } from "@/lib/spin-actions";

export async function generateMetadata(): Promise<Metadata> {
  const subdomain = await storeSubdomain();
  const { store } = await currentStore();
  const name = store && !store.house ? store.name : brand.name;
  return {
    ...(subdomain ? { metadataBase: new URL(`https://${subdomain}.bitocard.com`) } : {}),
    title: { absolute: `Your account | ${name}`, template: `%s | ${name}` },
    robots: { index: false, follow: false },
  };
}

/**
 * The customer account app (signed-in customers only): a header with the store's brand, search and menu; the tabs
 * (Home, Catalog, Orders, Wallet, Crypto, then Account, or Shop where BitoCard Shop is open for the customer, Account
 * then moving to the header) as a bottom bar on phones and tablets and, on desktop, a side rail or the same bottom bar
 * as the store (or BitoCard) chose; and a footer with only the copyright line.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [{ store, missing }, customer] = await Promise.all([currentStore(), currentCustomer()]);
  const shell = "flex min-h-svh flex-col overflow-x-clip bg-white text-navy-900";
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
  const [app, navigation, publicSpinClaim, shopMarket] = await Promise.all([
    store ? store.app : storeApi<StoreApp>("/v1/store/app").then(result => (result.ok ? result.data : undefined)),
    storeNavigation(),
    pendingPublicSpinClaim(),
    shopMarketFor(customer),
  ]);
  // On root, a customer whose fixed country now has its own live country store belongs there, same as the store pages
  // (docs/BITOCARD_COUNTRY_STORES_PLAN.md); their account is the same account, just served from its own address —
  // unless they explicitly chose to stay global, a standing choice that carries over into their account too.
  if (!store && !(await marketIsGlobal())) {
    const subdomain = countryStoreFor(navigation.countries, customer.country);
    if (subdomain) redirect(`https://${subdomain}.bitocard.com`);
  }
  // BitoCard Shop open for the customer: the Shop tab, with its unread chat messages on its menu.
  const unread = shopMarket ? await customerApi<{ unread: number }>("GET", "/v1/classifieds/conversations/unread") : null;
  const shop = shopMarket ? { browse: shopHref(`/${shopMarket.country.toLowerCase()}`), unread: unread?.ok ? unread.data.unread : 0 } : null;
  // What the desktop sub rails list: the catalogue's groups on sale (as the Catalog page's chips) and the customer's wallets.
  const subMenus = { groups: navigation.groups.filter(group => group.on_sale).map(({ key, label }) => ({ key, label })), currency: customer.currency, shop };
  const desktopNav: "rail" | "bottom" = app?.desktop_nav === "bottom" ? "bottom" : "rail";
  const rail = desktopNav === "rail";
  // A market's own country store is BitoCard's own, just localised: it wears BitoCard's own brand, like root. Only a
  // reseller's store wears its own name, logo and template colour theme.
  const reseller = Boolean(store) && !store!.house;
  const name = reseller ? store!.name : brand.name;
  return (
    <div className={shell} {...storeShell(reseller ? store!.design : undefined)}>
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
        shop={Boolean(shop)}
        initials={nameInitials(customer.name)}
        brand={
          reseller ? (
            <StoreName store={store!} />
          ) : (
            <span className="wordmark inline-flex items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 sm:text-[30px]">
              <Brand />
            </span>
          )
        }
      />
      <AppNav desktopNav={desktopNav} shop={Boolean(shop)} />
      <div className="flex flex-1">
        {rail ? <AppRail shop={Boolean(shop)} /> : null}
        {/* Desktop: a tab's own places (Catalog, Orders, Wallet, Crypto, Shop, Account screens) as a second rail; pills elsewhere. */}
        <Suspense fallback={null}>
          <SubRail context={subMenus} />
        </Suspense>
        <div className={`flex min-w-0 flex-1 flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] ${rail ? "lg:pb-0" : ""}`}>
          <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-8 sm:px-6 sm:pt-8 lg:px-8">
            {children}
          </main>
          <footer className="px-4 pb-6 text-center text-xs text-slate-500">
            © {new Date().getFullYear()} {name}
            {storeCredit(store, brand.credit) ? ` · ${storeCredit(store, brand.credit)}` : ""}
          </footer>
        </div>
      </div>
      {/* Chat with the store (it reads ?chat=1, so it sits in a Suspense). */}
      <Suspense fallback={null}>
        <ChatWidget store={name} aboveNav />
      </Suspense>
      <PublicSpinClaimDialog initial={publicSpinClaim} />
    </div>
  );
}
