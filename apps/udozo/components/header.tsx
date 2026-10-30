import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Menu, Plus } from "lucide-react";
import type { ShopMarket } from "@bitocard/api-client/classifieds";
import { nameInitials } from "@bitocard/api-client/classifieds";
import { signOut } from "@/lib/account-actions";
import type { Customer } from "@/lib/customer";
import { AskButton } from "./assistant";
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

/** The header's named places: the market, its categories and areas, and the Safe Trade Guide. */
function navLinks(market: ShopMarket | null) {
  const home = market ? `/${market.country.toLowerCase()}` : "/";
  return [
    { href: home, label: market ? `Browse ${market.name}` : "Browse" },
    ...(market ? [{ href: `${home}#categories`, label: "Categories" }, { href: `${home}/areas`, label: "Areas" }] : []),
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

/**
 * Udozo's top bar: the lockup, named links (the market, Categories, Areas, Safe pay and the Safe Trade Guide, and Ask
 * Anjio where the country's assistant answers), the country, the account (or Sign in) and **Sell** (`/sell`). Phones get
 * the links in a menu and Sell as a floating button.
 */
export function SiteHeader({ market, customer, showcase }: { market: ShopMarket | null; customer: Customer | null; showcase: boolean }) {
  const home = market ? `/${market.country.toLowerCase()}` : "/";
  const links = navLinks(market);
  const sellClass = "hidden min-h-11 items-center gap-2 rounded-xl bg-brand-500 px-4 text-[15px] font-semibold whitespace-nowrap text-white shadow-sm hover:bg-brand-600 sm:inline-flex";
  const country = market ? (
    showcase ? (
      <Link href="/" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold text-navy-900 hover:bg-navy-50 sm:px-3" aria-label={`Country: ${market.name}. Change`}>
        <Flag country={market.country} /> <span className="hidden sm:inline">{market.name}</span>
        <span className="sm:hidden">{market.country}</span> <ChevronDown className="size-4" aria-hidden="true" />
      </Link>
    ) : (
      <span className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[15px] font-semibold text-navy-900 sm:px-3" title={market.name}>
        <Flag country={market.country} /> <span className="hidden sm:inline">{market.name}</span>
        <span className="sm:hidden">{market.country}</span>
      </span>
    )
  ) : null;

  return (
    <header className="sticky top-0 z-30 border-b border-navy-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-2 px-4 sm:h-[72px] sm:px-6 lg:px-8">
        <UdozoWordmark href={home} />
        <nav aria-label="Udozo" className="hidden items-center gap-0.5 xl:flex">
          {links.map(link => (
            <Link key={link.href} href={link.href} className={linkClass}>
              {link.label}
            </Link>
          ))}
          {market ? <AskButton className={linkClass} /> : null}
        </nav>
        <div className="-mr-2 ml-auto flex items-center gap-1 sm:mr-0 sm:gap-2">
          {country}
          {customer ? (
            <details className="relative hidden lg:block">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 text-[15px] font-semibold text-navy-900 hover:border-navy-300 [&::-webkit-details-marker]:hidden">
                <span className="grid size-7 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white" aria-hidden="true">
                  {nameInitials(customer.name)}
                </span>
                Account <ChevronDown className="size-4" aria-hidden="true" />
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-60 rounded-2xl border border-navy-200 bg-white p-2 text-sm text-navy-900 shadow-lg">
                <p className="truncate px-3 py-2 text-navy-500">{customer.email}</p>
                {accountLinks.map(link => (
                  <Link key={link.href} href={link.href} className="block rounded-xl px-3 py-2 font-semibold hover:bg-navy-50">
                    {link.label}
                  </Link>
                ))}
                <form action={signOut}>
                  <button type="submit" className="w-full rounded-xl px-3 py-2 text-left font-semibold hover:bg-navy-50">
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          ) : (
            <SignInHere className="hidden min-h-11 items-center rounded-xl border border-navy-200 bg-white px-4 text-[15px] font-semibold whitespace-nowrap text-navy-900 hover:border-navy-300 lg:inline-flex">
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
          <MobileMenu links={links} customer={customer} ask={Boolean(market)} />
        </div>
      </div>
    </header>
  );
}

/** Below desktop width: the same links in a menu, with the account (or Sign in). */
function MobileMenu({ links, customer, ask }: { links: Array<{ href: string; label: string }>; customer: Customer | null; ask: boolean }) {
  const item = "flex min-h-11 items-center rounded-xl px-3 font-semibold hover:bg-navy-50";
  return (
    <details className="relative xl:hidden">
      <summary className="grid size-11 cursor-pointer list-none place-items-center rounded-xl text-navy-900 hover:bg-navy-50 [&::-webkit-details-marker]:hidden" aria-label="Menu">
        <Menu className="size-6" aria-hidden="true" />
      </summary>
      <nav aria-label="Udozo menu" className="absolute right-0 z-30 mt-2 grid w-64 gap-0.5 rounded-2xl border border-navy-200 bg-white p-2 text-[15px] text-navy-900 shadow-lg">
        {links.map(link => (
          <Link key={link.href} href={link.href} className={item}>
            {link.label}
          </Link>
        ))}
        {ask ? <AskButton className={`${item} w-full text-left`} /> : null}
        <div className="my-1 border-t border-navy-100 lg:hidden" />
        {customer ? (
          <div className="lg:hidden">
            <p className="truncate px-3 py-2 text-sm text-navy-500">{customer.email}</p>
            {accountLinks.map(link => (
              <Link key={link.href} href={link.href} className={item}>
                {link.label}
              </Link>
            ))}
            <form action={signOut}>
              <button type="submit" className={`${item} w-full text-left`}>
                Sign out
              </button>
            </form>
          </div>
        ) : (
          <SignInHere className={`${item} lg:hidden`}>Sign in</SignInHere>
        )}
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
