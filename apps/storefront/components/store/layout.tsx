import Link from "next/link";
import { LifeBuoy, Search, Store } from "lucide-react";
import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { Brand } from "@bitocard/ui/brand";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl, brand } from "@bitocard/ui/site";
import { type HostedStore, storeCredit } from "@/lib/store";
import { CountryPicker } from "./country-picker";
import { CurrencyMenu } from "./currency-menu";
import { MarketChooser } from "./market-chooser";
import { quickLinksFor } from "@/lib/quick-links";
import { DesktopNav, MobileMenu } from "./header-menus";
import { FooterCategories } from "./footer-categories";

/** A reseller's store name, with its logo when it has one. */
export function StoreName({ store, size = "lg" }: { store: HostedStore; size?: "lg" | "md" }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      {store.branding.logo_url ? (
        // eslint-disable-next-line @next/next/no-img-element -- the reseller's own logo, from any https address
        <img src={store.branding.logo_url} alt="" className={`${size === "lg" ? "size-10" : "size-9"} shrink-0 rounded-xl object-contain`} />
      ) : null}
      <span className={`truncate font-extrabold tracking-tight ${size === "lg" ? "text-[22px] sm:text-[26px]" : "text-[22px]"}`} style={{ color: store.branding.primary_color }}>
        {store.name}
      </span>
    </span>
  );
}

/**
 * The store header: wordmark, the category menus, then the shopper's country, currency, sign in and the reseller call
 * to action. A market's own country store (`ng.bitocard.com`…) wears bitocard.com's own wordmark and every business
 * link, exactly as root does: it is BitoCard's own retail arm there, localised, never rebranded. Only a reseller's
 * store shows its own name and logo, and drops the market, currency and reseller call to action.
 */
export function StoreHeader({
  groups,
  countries,
  market,
  marketLocked = false,
  signedIn,
  store = null,
  shop = null,
}: {
  groups: StoreNavigationGroup[];
  countries: StoreCountry[];
  market: string | null;
  /** On a market's own country store, or a reseller's: shown, not chosen. */
  marketLocked?: boolean;
  signedIn: boolean;
  store?: HostedStore | null;
  /** BitoCard Shop's address for the menu (`shopNavHref`), or null where it is not offered. */
  shop?: string | null;
}) {
  const reseller = Boolean(store) && !store!.house;
  const baseLinks = quickLinksFor(groups, store?.design?.template);
  const links = !reseller ? [...baseLinks, "/spin"] : baseLinks;
  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:h-[72px] sm:px-6 lg:px-8">
        {reseller ? (
          <Link href="/" aria-label={`${store!.name} home`} className="mr-2 inline-flex min-h-11 min-w-0 items-center no-underline">
            <StoreName store={store!} />
          </Link>
        ) : (
          <Link href="/" aria-label="Bitocard home" className="wordmark mr-2 inline-flex min-h-11 items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 no-underline sm:text-[32px]">
            <Brand />
          </Link>
        )}
        <DesktopNav groups={groups} links={links} shop={reseller ? null : shop} />
        <div className="-mr-2 ml-auto flex items-center gap-1 sm:mr-0 sm:gap-3">
          <Link href="/search" aria-label="Search" className="grid size-11 place-items-center rounded-xl text-navy-900 hover:bg-slate-50 xl:hidden">
            <Search className="size-5" aria-hidden="true" />
          </Link>
          {!store ? (
            <>
              <MarketChooser countries={countries} market={market} locked={marketLocked} />
              <div className="hidden lg:block">
                <CurrencyMenu />
              </div>
            </>
          ) : store.house ? (
            <a
              href={appUrl("storefront", "/go-global")}
              className="hidden min-h-11 items-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold text-navy-900 hover:bg-slate-50 sm:inline-flex sm:px-3"
              title="Shop every market on bitocard.com, priced in US dollars"
            >
              Shop globally
            </a>
          ) : null}
          <Link
            href={signedIn ? "/account" : "/signin"}
            className="hidden min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold whitespace-nowrap text-navy-900 hover:border-slate-300 lg:inline-flex"
          >
            {signedIn ? "Account" : "Sign in"}
          </Link>
          {!reseller ? (
            <Link
              href="/resellers"
              className="hidden min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-[15px] font-semibold whitespace-nowrap text-white shadow-sm hover:bg-brand-600 sm:inline-flex"
            >
              <Store className="size-5" aria-hidden="true" />
              Start Reselling
            </Link>
          ) : null}
          <MobileMenu groups={groups} signedIn={signedIn} reseller={reseller} links={links} shop={reseller ? null : shop} />
        </div>
      </div>
    </header>
  );
}

/**
 * Search with a country picker (with flags), in one white bar with the search button inside it. A plain form, so it
 * works before any script loads.
 */
export function SearchForm({ countries, q = "", country = "", size = "lg" }: { countries: StoreCountry[]; q?: string; country?: string; size?: "lg" | "md" }) {
  const tall = size === "lg" ? "min-h-16" : "min-h-14";
  return (
    <form action="/search" method="get" role="search" className={`flex w-full flex-col gap-2 rounded-2xl bg-white p-1.5 shadow-lg ring-1 ring-slate-200 sm:flex-row sm:items-stretch sm:gap-0 ${tall}`}>
      <label className="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-3 transition-colors focus-within:bg-slate-50 sm:px-4">
        <Search className="size-5 shrink-0 text-navy-900" aria-hidden="true" />
        <span className="sr-only">Search</span>
        <input name="q" type="search" autoComplete="off" defaultValue={q} placeholder="Find a product, brand or service" className="w-full min-w-0 bg-transparent text-base text-navy-900 outline-none placeholder:text-slate-400 sm:text-[17px]" />
      </label>
      <div className="flex items-stretch gap-1.5 border-t border-slate-100 pt-1.5 sm:border-t-0 sm:pt-0">
        <CountryPicker countries={countries} value={country} className="min-h-12 flex-1 sm:w-52 sm:flex-none sm:border-l sm:border-slate-200" />
        <button type="submit" aria-label="Search" className="grid min-h-12 w-16 shrink-0 place-items-center rounded-xl bg-brand-500 text-white hover:bg-brand-600 sm:w-20">
          <Search className="size-6" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

const footerLink = "inline-flex min-h-10 items-center hover:text-navy-900";

/**
 * The footer, the same on every page: the store's name, one All categories button (a full-screen grid, so categories
 * are never listed twice), help, the legal documents on one line, and the credit. bitocard.com, and a market's own
 * country store, add its business links and show BitoCard's own wordmark and credit; a reseller's store shows
 * nothing of BitoCard's own business, its own name instead, and white-label stores leave BitoCard's name out.
 */
export function StoreFooter({ groups, store = null }: { groups: StoreNavigationGroup[]; store?: HostedStore | null }) {
  const reseller = Boolean(store) && !store!.house;
  // Any store (house or reseller) lists only what it sells; bitocard.com every group, "Soon" where none is open yet.
  const shown = store ? groups.filter(group => group.on_sale) : groups;
  // Reseller terms are for resellers: bitocard.com shows them with its business links, never on a store. BitoCard Shop's
  // terms only on BitoCard's own sites, which offer it.
  const legal = legalDocuments.filter(doc => doc.href !== "/documents/reseller-terms" && !(reseller && doc.href === "/documents/shop-terms"));
  const credit = storeCredit(store, brand.credit);
  return (
    <footer className="mt-12 border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)] sm:mt-16">
      <div className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            {reseller ? (
              <Link href="/" aria-label={`${store!.name} home`} className="inline-flex min-w-0 items-center no-underline">
                <StoreName store={store!} size="md" />
              </Link>
            ) : (
              <Link href="/" aria-label="Bitocard home" className="wordmark inline-flex items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 no-underline">
                <Brand />
              </Link>
            )}
            <p className="mt-1 max-w-sm text-sm text-slate-500">Gift cards, top-ups, bills and digital essentials, delivered digitally.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FooterCategories groups={shown} />
            <Link href="/account/support" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-navy-900 hover:border-slate-300 hover:bg-slate-50">
              <LifeBuoy className="size-4" aria-hidden="true" /> Help
            </Link>
          </div>
        </div>
        {reseller ? null : (
          <nav aria-label="Business" className="mt-6 flex flex-wrap items-center gap-x-5 text-sm text-slate-600">
            <span className="font-semibold text-navy-900">For business</span>
            <Link href="/resellers" className={footerLink}>
              Open a reseller store
            </Link>
            <a href={appUrl("shq", "/signin")} className={footerLink}>
              Reseller sign in
            </a>
            <a href={appUrl("legals", "/documents/reseller-terms")} className={footerLink}>
              Reseller terms
            </a>
          </nav>
        )}
      </div>
      <div className="border-t border-slate-100">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-4 text-xs text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4">
            {legal.map(doc => (
              <a key={doc.href} href={appUrl("legals", doc.href)} className="inline-flex min-h-9 items-center hover:text-navy-900">
                {doc.short}
              </a>
            ))}
          </nav>
          <p>
            © {new Date().getFullYear()} {reseller ? store!.name : brand.name}
            {credit ? ` · ${credit}` : ""}
          </p>
        </div>
      </div>
    </footer>
  );
}
