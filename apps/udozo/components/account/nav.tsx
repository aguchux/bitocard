"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, Landmark, LayoutList, MessagesSquare, Plus, ReceiptText, ShieldCheck, Store, UserRound, WalletMinimal } from "lucide-react";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { accountPlaces, currentPlace, type PlaceCounts } from "@/lib/account-places";

const icons = { listings: LayoutList, messages: MessagesSquare, orders: ReceiptText, favourites: Heart, resellers: Store, wallet: WalletMinimal, "safe-pay": ShieldCheck, payouts: Landmark, profile: UserRound };

/**
 * The account's places: underlined tabs across the top on phones and tablets, a list beside the page on desktop. The
 * current place follows the address, so an order's or a chat's own page keeps Orders or Messages current.
 */
export function AccountNav({ counts }: { counts: PlaceCounts }) {
  const path = usePathname();
  const places = accountPlaces(counts);
  const current = currentPlace(places, path);
  return (
    <>
      <UnderlineTabs label="Your account" className="lg:hidden" current={current} tabs={places.map(({ href, label, badge, key }) => ({ href, label, badge, icon: icons[key] }))} />
      <nav aria-label="Your account" className="sticky top-24 hidden self-start lg:block">
        <ul className="grid gap-0.5">
          {places.map(place => {
            const Icon = icons[place.key];
            const on = place.href === current;
            return (
              <li key={place.href}>
                <Link
                  href={place.href}
                  aria-current={on ? "page" : undefined}
                  className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-slate-600 hover:bg-white hover:text-navy-900 aria-[current=page]:bg-white aria-[current=page]:text-navy-900 aria-[current=page]:shadow-[inset_3px_0_0_var(--color-brand-500)]"
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="flex-1">{place.label}</span>
                  {place.badge ? <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-bold text-white">{place.badge > 99 ? "99+" : place.badge}</span> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/** An account page's title, with Post an ad beside it. */
export function PageTitle({ title, note, post = true }: { title: string; note?: string; post?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        {note ? <p className="mt-1 text-sm text-slate-600">{note}</p> : null}
      </div>
      {post ? (
        <Link href="/sell" className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-600">
          <Plus className="size-4" strokeWidth={2.6} aria-hidden="true" />
          Post an ad
        </Link>
      ) : null}
    </div>
  );
}
