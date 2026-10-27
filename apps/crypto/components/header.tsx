import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { MarketSwitcher } from "@bitocard/crypto-ui/market-switcher";
import { signOut } from "@/lib/account-actions";
import { marketPath, markets } from "@/lib/api";
import { currentCustomer, signInPath } from "@/lib/customer";
import { tradeHref } from "@/lib/handoff";

/** The lockup on white, as on bitocard.com: the "b" mark, "Bito" navy, "card" pink, then "Crypto". */
export function CryptoWordmark() {
  return (
    <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 sm:text-[30px]" aria-label="BitoCard Crypto home">
      <Image src="/bitocard-mark.png" alt="" width={378} height={512} className="h-7 w-auto sm:h-8" priority />
      <span>
        Bito<span className="text-brand-500">card</span>
      </span>
      <span className="rounded-lg bg-navy-900 px-2 py-0.5 text-sm font-bold tracking-normal text-white">Crypto</span>
    </Link>
  );
}

/**
 * The markets as BitoCard's underlined tabs (the global market, then each country), the current one marked. Its own
 * small part: it reads the cached markets list and streams in, so the header never waits for it.
 */
export async function MarketNav({ current }: { current: string }) {
  const { data } = await markets();
  return <MarketSwitcher markets={data.map(({ market, name, currencies }) => ({ market, name, currencies }))} current={marketPath(current)} href={item => marketPath(item.market)} />;
}

/** The space the market tabs take, while they load. */
export function MarketNavSkeleton() {
  return <div aria-hidden="true" className="-mx-4 h-12 border-b-2 border-slate-200 sm:-mx-6" />;
}

/**
 * Trading and the account: signed in, **Trade now** opens their Crypto tab (on their country store, signed in there
 * through the handoff) with their first name and Sign out; signed out, Sign in. Its own small part: it reads the
 * signed-in customer (once per request, shared with the book's buttons) and streams in, so the header never waits.
 */
export async function AccountArea() {
  const customer = await currentCustomer();
  const button = "inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 text-sm font-bold text-white hover:bg-brand-600";
  if (!customer) {
    return (
      <span className="flex items-center gap-2">
        <Link href={signInPath("/")} className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-navy-900 hover:underline">
          Sign in
        </Link>
        <Link href={signInPath("/", "trade")} className={button}>
          Trade now
        </Link>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <form action={signOut} className="hidden sm:block">
        <button type="submit" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-slate-600 hover:text-navy-900">
          Sign out ({customer.name.split(/\s+/)[0]})
        </button>
      </form>
      <a href={tradeHref(customer.country, "/account/crypto")} className={button}>
        Trade now
      </a>
    </span>
  );
}

export function AccountAreaSkeleton() {
  return <span aria-hidden="true" className="h-11 w-28 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none" />;
}

/** The site's header: the lockup, the account area, and the market tabs (`current` is the market shown). */
export function Header({ current }: { current: string }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-2 sm:px-6">
        <CryptoWordmark />
        <Suspense fallback={<AccountAreaSkeleton />}>
          <AccountArea />
        </Suspense>
      </div>
      <div className="mx-auto max-w-[1400px] px-4 sm:px-6">
        <Suspense fallback={<MarketNavSkeleton />}>
          <MarketNav current={current} />
        </Suspense>
      </div>
    </header>
  );
}
