import Image from "next/image";
import Link from "next/link";
import { ChevronDown, Plus } from "lucide-react";
import type { ShopMarket } from "@bitocard/api-client/classifieds";
import { nameInitials } from "@bitocard/api-client/classifieds";
import { signOut } from "@/lib/account-actions";
import type { Customer } from "@/lib/customer";
import { myShopHref } from "@/lib/handoff";
import { AskButton } from "./assistant";
import { Flag } from "./flag";
import { SignInHere } from "./sign-in-here";

/** The lockup on navy: the light "b" mark, "Bito" white, "card" pink, then "Shop". */
export function ShopWordmark({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-1.5 text-xl font-extrabold tracking-tight text-white" aria-label="BitoCard Shop home">
      <Image src="/bitocard-mark-light.png" alt="" width={378} height={512} className="h-6 w-auto" priority />
      <span>
        Bito<span className="text-brand-500">card</span>
      </span>
      <span className="ml-0.5 text-sm font-semibold text-navy-200">Shop</span>
    </Link>
  );
}

/**
 * The Shop's top bar: the lockup, the country (changed on the global page once the showcase is on), **Sell** (Post an ad
 * in the Shop tab) and **My Shop** (the Shop tab on the customer's own country store, through the handoff), or Sign in.
 */
export function ShopHeader({ market, customer, showcase }: { market: ShopMarket | null; customer: Customer | null; showcase: boolean }) {
  const home = market ? `/${market.country.toLowerCase()}` : "/";
  const sellClass = "hidden h-9 items-center gap-1 rounded-full bg-brand-700 px-3.5 text-sm font-bold text-white hover:bg-brand-600 sm:flex";
  return (
    <div className="flex items-center justify-between gap-2">
      <ShopWordmark href={home} />
      <div className="flex items-center gap-2">
        {market ? <AskButton /> : null}
        {market ? (
          showcase ? (
            <Link href="/" className="flex h-9 items-center gap-1.5 rounded-full border border-navy-700 bg-navy-800 px-2.5 text-sm font-semibold text-white" aria-label={`Country: ${market.name}. Change`}>
              <Flag country={market.country} /> {market.country} <ChevronDown className="size-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <span className="flex h-9 items-center gap-1.5 rounded-full border border-navy-700 bg-navy-800 px-2.5 text-sm font-semibold text-white" title={market.name}>
              <Flag country={market.country} /> {market.country}
            </span>
          )
        ) : null}
        {customer?.country ? (
          <a href={myShopHref(customer.country, "/shop/post")} className={sellClass}>
            <Plus className="size-4" aria-hidden="true" /> Sell
          </a>
        ) : (
          <SignInHere reason="sell" className={sellClass}>
            <Plus className="size-4" aria-hidden="true" /> Sell
          </SignInHere>
        )}
        {customer ? (
          <details className="relative">
            <summary className="grid size-9 cursor-pointer list-none place-items-center rounded-full bg-brand-500 text-sm font-bold text-white [&::-webkit-details-marker]:hidden" aria-label="Your account">
              {nameInitials(customer.name)}
            </summary>
            <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-navy-200 bg-white p-2 text-sm text-navy-900 shadow-lg">
              <p className="truncate px-3 py-2 text-navy-500">{customer.email}</p>
              {customer.country ? (
                <a href={myShopHref(customer.country)} className="block rounded-xl px-3 py-2 font-semibold hover:bg-navy-50">
                  My Shop
                </a>
              ) : null}
              <form action={signOut}>
                <button type="submit" className="w-full rounded-xl px-3 py-2 text-left font-semibold hover:bg-navy-50">
                  Sign out
                </button>
              </form>
            </div>
          </details>
        ) : (
          <SignInHere className="flex h-9 items-center rounded-full border border-navy-700 px-3.5 text-sm font-semibold text-white hover:bg-navy-800">Sign in</SignInHere>
        )}
      </div>
    </div>
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
  return customer?.country ? (
    <a href={myShopHref(customer.country, "/shop/post")} className={className}>
      {label}
    </a>
  ) : (
    <SignInHere reason="sell" className={className}>
      {label}
    </SignInHere>
  );
}
