import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, UserRound } from "lucide-react";
import type { ShopMarket, ShopShowcase } from "@bitocard/api-client/classifieds";
import { nameInitials } from "@bitocard/api-client/classifieds";
import { Avatar } from "@bitocard/ui/avatar";
import { signOut } from "@/lib/account-actions";
import { markets, shopApi } from "@/lib/api";
import type { Customer } from "@/lib/customer";
import { categoriesOf } from "@/lib/reference";
import type { MenuCategory } from "./category-menu";
import { CountryMenu, type MenuCountry } from "./country-menu";
import { Dropdown } from "./dropdown";
import { Flag } from "./flag";
import { type ContinueTo, HeaderSearch, SearchBlend } from "./header-search";
import { HelpMenu } from "./help-menu";
import { NotificationBell } from "./notifications/bell";
import { SignInHere } from "./sign-in-here";
import { sellHref } from "@/lib/sell-sources";
import { channelsFor } from "@/lib/whatsapp";
import { whatsappMarket } from "@/lib/whatsapp-sign-in";
import { WhatsappTab } from "./whatsapp-tab";

/** Udozo's lockup on white: the "u" mark, then the name. */
export function UdozoWordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="mr-2 inline-flex min-h-11 shrink-0 items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 sm:text-[30px]" aria-label="Udozo home">
      <Image src="/udozo-mark.png" alt="" width={518} height={512} className="h-7 w-auto sm:h-8" priority />
      <span>Udozo</span>
    </Link>
  );
}

/** The signed-in customer's own places, in the account menu. */
const accountLinks = [
  { href: "/account", label: "My listings" },
  { href: "/account/messages", label: "Messages" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/wallet", label: "Wallet" },
  { href: "/account/profile", label: "Profile" },
];

/** The categories the header's menu offers: the market's, with their subcategories, or the showcase's across countries. */
async function menuCategories(market: ShopMarket | null): Promise<MenuCategory[]> {
  if (market) {
    return (await categoriesOf(market.country)).map(top => ({ slug: top.slug, name: top.name, icon: top.icon, children: top.children.map(child => ({ slug: child.slug, name: child.name, icon: child.icon })) }));
  }
  const showcase = await shopApi<ShopShowcase>("/v1/classifieds/showcase");
  return showcase.ok ? showcase.data.categories.map(category => ({ slug: category.slug, name: category.name, icon: category.icon })) : [];
}

/** Udozo's top bar, with the market's categories for its menu, the open markets for the country menu, and (with no market) the customer's own to go to. */
export async function SiteHeader({ market, customer, showcase }: { market: ShopMarket | null; customer: Customer | null; showcase: boolean }) {
  const [categories, all, whatsapp] = await Promise.all([menuCategories(market), markets(), whatsappNumber(market)]);
  const own = market ? undefined : all.data.find(item => item.country === customer?.country);
  const countries = all.data.map(item => ({ country: item.country, name: item.name, listings: item.listings }));
  return <HeaderBar market={market} customer={customer} showcase={showcase} categories={categories} countries={countries} continueTo={own ? { country: own.country, name: own.name } : null} whatsapp={whatsapp} />;
}

/** Udozo's WhatsApp number for the header's tab: the market's where it is open there; across countries, the visitor's chosen or first open one. */
async function whatsappNumber(market: ShopMarket | null) {
  if (!market) return (await whatsappMarket())?.number ?? null;
  const channels = await channelsFor(market.country);
  return channels.whatsapp.available ? channels.whatsapp.number : null;
}

/**
 * Udozo's top bar, mobile first: the lockup, then one bar of the **Categories** menu (its navy left end, opening a drawer)
 * and the search (with no market, "Continue to <their country>"), on its own full-width row on phones and tablets and
 * beside the lockup from desktops (and, where Udozo is on WhatsApp, its green tab on the screen's right edge); on the right **Get help** (a menu: Safe pay, FAQs, Resell on Udozo, Contact us…), the country (a dropdown of the open
 * markets from the second one), just left of the account's profile icon, and **Sell** (`/sell`; a floating button on phones).
 */
export function HeaderBar({ market, customer, showcase, categories, countries = [], continueTo = null, whatsapp = null }: { market: ShopMarket | null; customer: Customer | null; showcase: boolean; categories: MenuCategory[]; countries?: MenuCountry[]; continueTo?: ContinueTo; /** Udozo's WhatsApp number where it is open: the tab hanging under the header. */ whatsapp?: string | null }) {
  const home = market ? `/${market.country.toLowerCase()}` : "/";
  const search = { country: market?.country ?? null, categories, prefix: market ? `${home}/c/` : "/c/", allHref: market ? `${home}/search` : "/", place: market?.name ?? null, continueTo };
  const sellClass = "hidden min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-[15px] font-semibold whitespace-nowrap text-white shadow-sm hover:bg-brand-600 sm:inline-flex";
  // One market: nothing to switch to, so just its flag. From the second, the dropdown (on the global page too).
  const country = showcase ? (
    <CountryMenu current={market ? { country: market.country, name: market.name } : null} countries={countries} />
  ) : market ? (
    <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-[15px] font-semibold text-navy-900" title={market.name}>
      <Flag country={market.country} /> <span className="hidden md:inline">{market.name}</span>
      <span className="hidden sm:inline md:hidden">{market.country}</span>
    </span>
  ) : null;

  return (
    <>
    <header className="sticky top-0 z-30 border-b border-navy-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-1.5 gap-y-2 px-4 pt-2.5 pb-3 sm:gap-x-2 sm:px-6 lg:h-[72px] lg:flex-nowrap lg:gap-x-4 lg:px-8 lg:py-0">
        <UdozoWordmark href={home} />
        {/* `min-w-0`: the bar takes the row's width, never its contents' (the search field, Near me), so it never widens the page. */}
        <div data-header-search className="order-last min-w-0 basis-full lg:order-none lg:max-w-3xl lg:flex-1 lg:basis-auto lg:pb-0">
          <Suspense fallback={<SearchBlend {...search} />}>
            <HeaderSearch {...search} />
          </Suspense>
        </div>
        <div className="-mr-2 ml-auto flex items-center gap-0.5 sm:mr-0 sm:gap-2">
          <HelpMenu />
          {customer ? <NotificationBell /> : null}
          {country}
          <ProfileMenu customer={customer} />
          {customer ? null : (
            <SignInHere className="hidden min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-[15px] font-semibold whitespace-nowrap text-navy-900 hover:border-navy-300 lg:inline-flex">
              Sign in
            </SignInHere>
          )}
          {customer ? (
            <Link href={sellHref("header")} className={sellClass}>
              <Plus className="size-5" aria-hidden="true" /> Sell
            </Link>
          ) : (
            <SignInHere reason="sell" next={sellHref("header")} className={sellClass}>
              <Plus className="size-5" aria-hidden="true" /> Sell
            </SignInHere>
          )}
        </div>
      </div>
    </header>
    {/* Outside the header: its blur would hold a fixed child inside it, and the tab stands on the screen's right edge. */}
    {whatsapp ? <WhatsappTab number={whatsapp} signedIn={Boolean(customer)} /> : null}
    </>
  );
}

/**
 * The account's profile icon alone (its initials; a person icon when signed out) and its menu: the account's places and
 * Sign out, or Sign in and Create an account. Signed out on desktops, Sign in is also a button beside it. It closes on
 * a click outside, Escape or choosing a place (`Dropdown`).
 */
function ProfileMenu({ customer }: { customer: Customer | null }) {
  const item = "flex min-h-11 items-center rounded-xl px-3 font-semibold hover:bg-navy-50";
  return (
    <Dropdown>
      <summary
        className="inline-flex size-11 cursor-pointer list-none items-center justify-center rounded-full text-navy-900 hover:bg-navy-50 [&::-webkit-details-marker]:hidden"
        aria-label={customer ? `Account: ${customer.name}` : "Account menu"}
      >
        {customer?.avatar_url ? (
          <Avatar name={customer.name} url={customer.avatar_url} className="size-8 text-xs" />
        ) : customer ? (
          <span className="grid size-8 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white" aria-hidden="true">
            {nameInitials(customer.name)}
          </span>
        ) : (
          <span className="grid size-8 place-items-center rounded-full border-2 border-navy-900 text-navy-900" aria-hidden="true">
            <UserRound className="size-4.5" strokeWidth={2.4} />
          </span>
        )}
      </summary>
      <nav aria-label="Account" className="absolute right-4 z-30 mt-2 grid max-h-[calc(100dvh-5.5rem)] w-64 max-w-[calc(100vw-2rem)] gap-0.5 sm:right-0 overflow-y-auto rounded-2xl border border-navy-200 bg-white p-2 text-[15px] text-navy-900 shadow-lg">
        {customer ? (
          <>
            <p className="truncate px-3 py-2 text-sm text-navy-500">{customer.email}</p>
            {accountLinks.map(link => (
              <Link key={link.href} href={link.href} className={item}>
                {link.label}
              </Link>
            ))}
          </>
        ) : (
          <>
            <SignInHere className={item}>Sign in</SignInHere>
            <Link href="/signup" className={item}>
              Create an account
            </Link>
          </>
        )}
        {customer ? (
          <form action={signOut} className="mt-1 border-t border-navy-100 pt-1">
            <button type="submit" className={`${item} w-full text-left`}>
              Sign out
            </button>
          </form>
        ) : null}
      </nav>
    </Dropdown>
  );
}

/** The floating Sell button on phones (the header has it from tablets up). */
export function SellButton({ customer }: { customer: Customer | null }) {
  const className = "fixed right-4 bottom-6 z-20 flex h-13 items-center gap-2 rounded-full bg-brand-700 px-5 font-bold text-white shadow-[0_8px_24px_rgba(192,11,88,0.35)] sm:hidden";
  const label = (
    <>
      <Plus className="size-5" aria-hidden="true" strokeWidth={2.4} /> Sell
    </>
  );
  return customer ? (
    <Link href={sellHref("header_phone")} className={className}>
      {label}
    </Link>
  ) : (
    <SignInHere reason="sell" next={sellHref("header_phone")} className={className}>
      {label}
    </SignInHere>
  );
}
