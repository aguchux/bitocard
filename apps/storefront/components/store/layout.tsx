import Link from "next/link";
import { Search, Store } from "lucide-react";
import type { StoreCountry, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { Brand } from "@bitocard/ui/brand";
import { legalDocuments } from "@bitocard/ui/legal";
import { appUrl, brand } from "@bitocard/ui/site";
import { DesktopNav, MobileMenu } from "./header-menus";

/** The store header: wordmark, the category menus, and the reseller call to action. */
export function StoreHeader({ groups }: { groups: StoreNavigationGroup[] }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label="Bitocard home" className="wordmark mr-2 inline-flex items-center gap-2 text-[28px] font-extrabold tracking-tight text-[#070f4c] no-underline sm:text-[32px]">
          <Brand />
        </Link>
        <DesktopNav groups={groups} />
        <div className="ml-auto flex items-center gap-2">
          <Link href="/search" aria-label="Search" className="grid size-11 place-items-center rounded-xl text-[#070f4c] hover:bg-slate-50 md:hidden">
            <Search className="size-5" aria-hidden="true" />
          </Link>
          <Link
            href="/resellers"
            className="hidden min-h-11 items-center gap-2 rounded-xl bg-[#ff2382] px-4 text-[15px] font-semibold text-white shadow-sm hover:bg-[#e8116d] sm:inline-flex"
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

/** Search with a country picker; a plain form, so it works before any script loads. */
export function SearchForm({ countries, q = "", country = "", size = "lg" }: { countries: StoreCountry[]; q?: string; country?: string; size?: "lg" | "md" }) {
  const tall = size === "lg" ? "min-h-16" : "min-h-13";
  return (
    <form action="/search" method="get" role="search" className={`flex w-full flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-0 sm:rounded-2xl sm:bg-white sm:shadow-lg sm:ring-1 sm:ring-slate-200`}>
      <label className={`flex flex-1 items-center gap-3 rounded-2xl bg-white px-4 shadow-lg ring-1 ring-slate-200 sm:rounded-r-none sm:shadow-none sm:ring-0 ${tall}`}>
        <Search className="size-5 shrink-0 text-slate-500" aria-hidden="true" />
        <span className="sr-only">Search</span>
        <input name="q" type="search" defaultValue={q} placeholder="Find a product, brand or service" className="w-full bg-transparent text-base text-[#070f4c] outline-none placeholder:text-slate-400" />
      </label>
      <div className="flex gap-2 sm:gap-0">
        <label className={`flex flex-1 items-center rounded-2xl bg-white px-3 shadow-lg ring-1 ring-slate-200 sm:rounded-none sm:border-l sm:border-slate-200 sm:shadow-none sm:ring-0 ${tall}`}>
          <span className="sr-only">Country</span>
          <select name="country" defaultValue={country} className="w-full bg-transparent text-sm font-medium text-[#070f4c] outline-none sm:w-44">
            <option value="">All countries</option>
            <option value="global">Usable anywhere</option>
            {countries.map(item => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" aria-label="Search" className={`grid w-16 shrink-0 place-items-center rounded-2xl bg-[#ff2382] text-white hover:bg-[#e8116d] sm:rounded-l-none sm:w-20 ${tall}`}>
          <Search className="size-6" aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

export function StoreFooter({ groups }: { groups: StoreNavigationGroup[] }) {
  return (
    <footer className="mt-16 border-t border-slate-100 bg-white">
      <div className="mx-auto grid max-w-[1400px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-4 lg:px-8">
        <div>
          <Link href="/" aria-label="Bitocard home" className="wordmark inline-flex items-center gap-2 text-[26px] font-extrabold tracking-tight text-[#070f4c] no-underline">
            <Brand />
          </Link>
          <p className="mt-3 max-w-xs text-sm text-slate-500">Gift cards, mobile top-ups, bills and digital essentials, delivered digitally.</p>
        </div>
        <nav aria-label="Shop" className="text-sm">
          <p className="font-semibold text-[#070f4c]">Shop</p>
          <ul className="mt-2 space-y-1">
            {groups.map(group => (
              <li key={group.key}>
                <Link href={`/catalogs/${group.categories.length === 1 ? group.categories[0].category : group.key}`} className="inline-flex min-h-9 items-center text-slate-600 hover:text-[#070f4c]">
                  {group.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Business" className="text-sm">
          <p className="font-semibold text-[#070f4c]">Business</p>
          <ul className="mt-2 space-y-1">
            <li>
              <Link href="/resellers" className="inline-flex min-h-9 items-center text-slate-600 hover:text-[#070f4c]">
                Open a reseller store
              </Link>
            </li>
            <li>
              <a href={appUrl("shq", "/signin")} className="inline-flex min-h-9 items-center text-slate-600 hover:text-[#070f4c]">
                Reseller sign in
              </a>
            </li>
          </ul>
        </nav>
        <nav aria-label="Legal" className="text-sm">
          <p className="font-semibold text-[#070f4c]">Legal</p>
          <ul className="mt-2 space-y-1">
            {legalDocuments.map(doc => (
              <li key={doc.href}>
                <a href={appUrl("legals", doc.href)} className="inline-flex min-h-9 items-center text-slate-600 hover:text-[#070f4c]">
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
