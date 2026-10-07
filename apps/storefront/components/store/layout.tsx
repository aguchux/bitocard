import Link from "next/link";
import { Search, Store } from "lucide-react";
import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { Brand } from "@bitocard/ui/brand";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl, brand } from "@bitocard/ui/site";
import { CountryPicker } from "./country-picker";
import { CurrencyMenu } from "./currency-menu";
import { MarketChooser } from "./market-chooser";
import { DesktopNav, MobileMenu } from "./header-menus";

/** The store header: wordmark, the category menus, then the shopper's country, currency, sign in and the reseller call to action. */
export function StoreHeader({ groups, countries, market }: { groups: StoreNavigationGroup[]; countries: StoreCountry[]; market: string | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-4 px-4 sm:h-[72px] sm:px-6 lg:px-8">
        <Link href="/" aria-label="Bitocard home" className="wordmark mr-2 inline-flex min-h-11 items-center gap-2 text-[26px] font-extrabold tracking-tight text-[#070f4c] no-underline sm:text-[32px]">
          <Brand />
        </Link>
        <DesktopNav groups={groups} />
        <div className="-mr-2 ml-auto flex items-center gap-1 sm:mr-0 sm:gap-3">
          <Link href="/search" aria-label="Search" className="grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50 xl:hidden">
            <Search className="size-5" aria-hidden="true" />
          </Link>
          <MarketChooser countries={countries} market={market} />
          <div className="hidden lg:block">
            <CurrencyMenu />
          </div>
          <Link href="/signin" className="hidden min-h-11 items-center rounded-xl border border-slate-200 bg-white px-4 text-[15px] font-semibold whitespace-nowrap text-[#070f4c] hover:border-slate-300 lg:inline-flex">
            Sign in
          </Link>
          <Link
            href="/resellers"
            className="hidden min-h-11 items-center gap-2 rounded-xl bg-[#ff2382] px-4 text-[15px] font-semibold whitespace-nowrap text-white shadow-sm hover:bg-[#e8116d] sm:inline-flex"
          >
            <Store className="size-5" aria-hidden="true" />
            Open a reseller store
          </Link>
          <MobileMenu groups={groups} />
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
        <Search className="size-5 shrink-0 text-[#070f4c]" aria-hidden="true" />
        <span className="sr-only">Search</span>
        <input name="q" type="search" autoComplete="off" defaultValue={q} placeholder="Find a product, brand or service" className="w-full min-w-0 bg-transparent text-base text-[#070f4c] outline-none placeholder:text-slate-400 sm:text-[17px]" />
      </label>
      <div className="flex items-stretch gap-1.5 border-t border-slate-100 pt-1.5 sm:border-t-0 sm:pt-0">
        <CountryPicker countries={countries} value={country} className="min-h-12 flex-1 sm:w-52 sm:flex-none sm:border-l sm:border-slate-200" />
        <button type="submit" aria-label="Search" className="grid min-h-12 w-16 shrink-0 place-items-center rounded-xl bg-[#ff2382] text-white hover:bg-[#e8116d] sm:w-20">
          <Search className="size-6" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

export function StoreFooter({ groups }: { groups: StoreNavigationGroup[] }) {
  return (
    <footer className="mt-12 border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)] sm:mt-16">
      {/* Phones: the brand across the top, then the link lists two to a row. */}
      <div className="mx-auto grid max-w-[1400px] grid-cols-2 gap-x-6 gap-y-8 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
        <div className="col-span-2 md:col-span-1">
          <Link href="/" aria-label="Bitocard home" className="wordmark inline-flex items-center gap-2 text-[26px] font-extrabold tracking-tight text-[#070f4c] no-underline">
            <Brand />
          </Link>
          <p className="mt-3 max-w-xs text-sm text-slate-500">Gift cards, mobile top-ups, bills and digital essentials, delivered digitally.</p>
        </div>
        <nav aria-label="Shop" className="text-sm">
          <p className="font-semibold text-[#070f4c]">Shop</p>
          <ul className="mt-2">
            {groups.map(group => (
              <li key={group.key}>
                <Link href={`/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`} className="inline-flex min-h-10 items-center text-slate-600 hover:text-[#070f4c]">
                  {group.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Business" className="text-sm">
          <p className="font-semibold text-[#070f4c]">Business</p>
          <ul className="mt-2">
            <li>
              <Link href="/resellers" className="inline-flex min-h-10 items-center text-slate-600 hover:text-[#070f4c]">
                Open a reseller store
              </Link>
            </li>
            <li>
              <a href={appUrl("shq", "/signin")} className="inline-flex min-h-10 items-center text-slate-600 hover:text-[#070f4c]">
                Reseller sign in
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Legal" className="text-sm">
          <p className="font-semibold text-[#070f4c]">Legal</p>
          <ul className="mt-2">
            {legalDocuments.map(doc => (
              <li key={doc.href}>
                <a href={appUrl("legals", doc.href)} className="inline-flex min-h-10 items-center text-slate-600 hover:text-[#070f4c]">
                  {doc.short}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-slate-100 py-5 text-center text-xs text-slate-500">{brand.credit}</p>
    </footer>
  );
}
