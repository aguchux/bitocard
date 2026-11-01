import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Plus, UserRound } from "lucide-react";
import type { ShopMarket, ShopShowcase } from "@bitocard/api-client/classifieds";
import { nameInitials } from "@bitocard/api-client/classifieds";
import { signOut } from "@/lib/account-actions";
import { shopApi } from "@/lib/api";
import type { Customer } from "@/lib/customer";
import { categoriesOf } from "@/lib/reference";
import { AskButton } from "./assistant";
import { CategoryMenu, type MenuCategory } from "./category-menu";
import { Flag } from "./flag";
import { SignInHere } from "./sign-in-here";

/** Udozo's lockup on white: the "u" mark, then the name. */
export function UdozoWordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="mr-2 inline-flex min-h-11 shrink-0 items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 sm:text-[30px]" aria-label="Udozo home">
      <Image src="/udozo-mark.png" alt="" width={466} height={512} className="h-7 w-auto sm:h-8" priority />
      <span>Udozo</span>
    </Link>
  );
}

/** The header's named places: the market and its areas, Safe pay and the Safe Trade Guide (categories have their own menu). */
function navLinks(market: ShopMarket | null) {
  const home = market ? `/${market.country.toLowerCase()}` : "/";
  return [
    { href: home, label: market ? `Browse ${market.name}` : "Browse" },
    ...(market ? [{ href: `${home}/areas`, label: "Areas" }] : []),
    { href: "/safe-trade#safe-pay", label: "Safe pay" },
    { href: "/safe-trade", label: "Safe Trade Guide" },
  ];
}

/** The signed-in customer's own places, in the account menu. */
const accountLinks = [
  { href: "/account", label: "My listings" },
  { href: "/account/messages", label: "Messages" },
  { href: "/account/orders", label: "Orders" },
  { href: "/account/wallet", label: "Wallet" },
  { href: "/account/profile", label: "Profile" },
];

const linkClass = "inline-flex min-h-11 items-center rounded-xl px-3 text-[15px] font-semibold whitespace-nowrap text-navy-900 hover:bg-navy-50";

/** The categories the header's menu offers: the market's, with their subcategories, or the showcase's across countries. */
async function menuCategories(market: ShopMarket | null): Promise<MenuCategory[]> {
  if (market) {
    return (await categoriesOf(market.country)).map(top => ({ slug: top.slug, name: top.name, icon: top.icon, children: top.children.map(child => ({ slug: child.slug, name: child.name, icon: child.icon })) }));
  }
  const showcase = await shopApi<ShopShowcase>("/v1/classifieds/showcase");
  return showcase.ok ? showcase.data.categories.map(category => ({ slug: category.slug, name: category.name, icon: category.icon })) : [];
}

/** Udozo's top bar, with the market's categories loaded for its menu. */
export async function SiteHeader({ market, customer, showcase }: { market: ShopMarket | null; customer: Customer | null; showcase: boolean }) {
  return <HeaderBar market={market} customer={customer} showcase={showcase} categories={await menuCategories(market)} />;
}

/**
 * Udozo's top bar, mobile first: the lockup and, right of it, the **Categories** menu (a bordered menu button opening a
 * drawer); the named links on desktops; then on the right the country, just left of the account's profile icon (or
 * Sign in), and **Sell** (`/sell`). The profile menu also holds the named links below desktop width, so the bar has
 * room for the categories; phones get Sell as a floating button.
 */
export function HeaderBar({ market, customer, showcase, categories }: { market: ShopMarket | null; customer: Customer | null; showcase: boolean; categories: MenuCategory[] }) {
  const home = market ? `/${market.country.toLowerCase()}` : "/";
  const links = navLinks(market);
  const sellClass = "hidden min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-[15px] font-semibold whitespace-nowrap text-white shadow-sm hover:bg-brand-600 sm:inline-flex";
  const flag = market ? (
    <>
      <Flag country={market.country} /> <span className="hidden md:inline">{market.name}</span>
      <span className="md:hidden">{market.country}</span>
    </>
  ) : null;
  const country = market ? (
    showcase ? (
      <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold text-navy-900 hover:bg-navy-50" aria-label={`Country: ${market.name}. Change`}>
        {flag} <ChevronDown className="size-4" aria-hidden="true" />
      </Link>
    ) : (
      <span className="inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2 text-[15px] font-semibold text-navy-900" title={market.name}>
        {flag}
      </span>
    )
  ) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-navy-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-1.5 px-4 sm:h-[72px] sm:gap-2 sm:px-6 lg:px-8">
        <UdozoWordmark href={home} />
        <CategoryMenu categories={categories} prefix={market ? `${home}/c/` : "/c/"} allHref={market ? `${home}/search` : "/"} place={market?.name ?? null} />
        <nav aria-label="Udozo" className="ml-2 hidden items-center gap-0.5 xl:flex">
          {links.map(link => (
            <Link key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </Link>
          ))}
          {market ? <AskButton className={linkClass} /> : null}
        </nav>
        <div className="-mr-2 ml-auto flex items-center gap-0.5 sm:mr-0 sm:gap-2">
          {country}
          <ProfileMenu links={links} customer={customer} ask={Boolean(market)} />
          {customer ? null : (
            <SignInHere className="hidden min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-[15px] font-semibold whitespace-nowrap text-navy-900 hover:border-navy-300 xl:inline-flex">
              Sign in
            </SignInHere>
          )}
          {customer ? (
            <Link href="/sell" className={sellClass}>
              <Plus className="size-5" aria-hidden="true" /> Sell
            </Link>
          ) : (
            <SignInHere reason="sell" className={sellClass}>
              <Plus className="size-5" aria-hidden="true" /> Sell
            </SignInHere>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * The account's profile icon (its initials; a person icon when signed out) and its menu: the account's places and
 * Sign out, or Sign in, plus the named links below desktop width. Signed out on desktops, Sign in is a button instead.
 */
function ProfileMenu({ links, customer, ask }: { links: Array<{ href: string; label: string }>; customer: Customer | null; ask: boolean }) {
  const item = "flex min-h-11 items-center rounded-xl px-3 font-semibold hover:bg-navy-50";
  return (
    <details className={`relative ${customer ? "" : "xl:hidden"}`}>
      <summary
        className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center gap-2 rounded-xl text-[15px] font-semibold text-navy-900 hover:bg-navy-50 lg:border lg:border-navy-200 lg:bg-white lg:px-3 lg:hover:border-navy-300 [&::-webkit-details-marker]:hidden"
        aria-label={customer ? `Account: ${customer.name}` : "Account menu"}
      >
        {customer ? (
          <span className="grid size-8 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white" aria-hidden="true">
            {nameInitials(customer.name)}
          </span>
        ) : (
          <span className="grid size-8 place-items-center rounded-full border-2 border-navy-900 text-navy-900" aria-hidden="true">
            <UserRound className="size-4.5" strokeWidth={2.4} />
          </span>
        )}
        <span className="hidden lg:inline">{customer ? "Account" : "Menu"}</span>
        <ChevronDown className="hidden size-4 lg:block" aria-hidden="true" />
      </summary>
      <nav aria-label="Account" className="absolute right-0 z-30 mt-2 grid max-h-[calc(100dvh-5.5rem)] w-64 gap-0.5 overflow-y-auto rounded-2xl border border-navy-200 bg-white p-2 text-[15px] text-navy-900 shadow-lg">
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
          <SignInHere className={item}>Sign in</SignInHere>
        )}
        <div className="xl:hidden">
          <div className="my-1 border-t border-navy-100" />
          {links.map(link => (
            <Link key={link.href} href={link.href} className={item}>
              {link.label}
            </Link>
          ))}
          {ask ? <AskButton className={`${item} w-full text-left`} /> : null}
        </div>
        {customer ? (
          <form action={signOut} className="mt-1 border-t border-navy-100 pt-1">
            <button type="submit" className={`${item} w-full text-left`}>
              Sign out
            </button>
          </form>
        ) : null}
      </nav>
    </details>
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
    <Link href="/sell" className={className}>
      {label}
    </Link>
  ) : (
    <SignInHere reason="sell" className={className}>
      {label}
    </SignInHere>
  );
}
