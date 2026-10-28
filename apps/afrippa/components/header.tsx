import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import { Bell } from "lucide-react";
import { MarketSwitcher } from "@afrippa/ui/market-switcher";
import { signOut } from "@/lib/account-actions";
import { marketPath, markets } from "@/lib/api";
import { currentCustomer, customerApi, signInPath } from "@/lib/customer";

/** The lockup on white: the "a" mark, then "Afri" in the ink colour and "ppa" in the accent. */
export function AfrippaWordmark() {
  return (
    <Link href="/" className="inline-flex min-h-11 shrink-0 items-center gap-2 text-[26px] font-extrabold tracking-tight text-navy-900 sm:text-[30px]" aria-label="Afrippa home">
      <Image src="/afrippa-mark.png" alt="" width={522} height={512} className="h-7 w-auto sm:h-8" priority />
      <span>
        Afri<span className="text-brand-500">ppa</span>
      </span>
    </Link>
  );
}

/**
 * The markets as underlined tabs (the global market, then each country), the current one marked. Its own
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
 * The account: signed in, their wallets, ads and trades here (Wallets alone on phones, where the account's tabs do the
 * rest) and Sign out with their first name; signed out, Sign in and Create an account. Its own small part: it reads the
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
        <Link href="/signup" className={button}>
          Create an account
        </Link>
      </span>
    );
  }
  const link = "hidden min-h-11 items-center px-2 text-sm font-semibold text-navy-900 hover:underline sm:inline-flex";
  const unread = await customerApi<{ count: number }>("GET", "/v1/afrippa/account/notifications/unread-count");
  const count = unread.ok ? unread.data.count : 0;
  return (
    <span className="flex items-center gap-1">
      <Link href="/notifications" className="relative inline-flex size-11 items-center justify-center rounded-xl text-navy-900 hover:bg-slate-50" aria-label={count ? `Notifications, ${count} unread` : "Notifications"}>
        <Bell className="size-5" aria-hidden="true" />
        {count ? (
          <span aria-hidden="true" className="absolute top-1.5 right-1.5 grid min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] leading-4 font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
      <Link href="/orders" className={link}>
        Orders
      </Link>
      <Link href="/ads" className={link}>
        My ads
      </Link>
      <form action={signOut} className="hidden lg:block">
        <button type="submit" className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-slate-600 hover:text-navy-900">
          Sign out ({customer.name.split(/\s+/)[0]})
        </button>
      </form>
      <Link href="/wallets" className={button}>
        Wallets
      </Link>
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
        <AfrippaWordmark />
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
