"use client";

import Link from "next/link";
import { Check, ChevronDown, Globe2 } from "lucide-react";
import { Dropdown } from "./dropdown";
import { Flag } from "./flag";

export type MenuCountry = { country: string; name: string; listings: number };

/** The id the header's bar opens the menu by ("Choose your country" on the global page). */
export const countryMenuId = "country-menu";

/** Opens the header's country menu and moves focus into it. */
export function openCountryMenu() {
  const menu = document.getElementById(countryMenuId);
  if (!(menu instanceof HTMLDetailsElement)) return false;
  menu.open = true;
  menu.querySelector("summary")?.focus();
  return true;
}

const listingCount = (count: number) => `${count.toLocaleString("en-GB")} ${count === 1 ? "listing" : "listings"}`;

/**
 * The header's country switch: the flag (the code from tablets, the name from desktops) opening a dropdown of the open
 * markets, the current one ticked, then All countries. It closes on choosing, on Escape and on a click outside
 * (`Dropdown`), since the header stays across pages.
 */
export function CountryMenu({ current, countries }: { current: { country: string; name: string } | null; countries: MenuCountry[] }) {
  const row = "flex min-h-12 items-center gap-3 rounded-xl px-3 font-semibold hover:bg-navy-50";
  return (
    <Dropdown id={countryMenuId}>
      <summary
        className="inline-flex min-h-11 shrink-0 cursor-pointer list-none items-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold text-navy-900 hover:bg-navy-50 lg:border lg:border-navy-200 lg:bg-white lg:px-3 lg:hover:border-navy-300 [&::-webkit-details-marker]:hidden"
        aria-label={current ? `Country: ${current.name}. Change` : "Choose your country"}
      >
        {current ? (
          <>
            <Flag country={current.country} /> <span className="hidden md:inline">{current.name}</span>
            <span className="hidden sm:inline md:hidden">{current.country}</span>
          </>
        ) : (
          <>
            <Globe2 className="size-5 text-navy-600" aria-hidden="true" /> <span className="hidden md:inline">Country</span>
          </>
        )}
        <ChevronDown className="size-4" aria-hidden="true" />
      </summary>
      <nav aria-label="Countries" className="absolute right-0 z-30 mt-2 grid max-h-[calc(100dvh-5.5rem)] w-72 max-w-[calc(100vw-2rem)] gap-0.5 overflow-y-auto rounded-2xl border border-navy-200 bg-white p-2 text-[15px] text-navy-900 shadow-lg">
        <p className="px-3 pt-1 pb-2 text-xs font-bold tracking-wide text-navy-500 uppercase">Choose your country</p>
        {countries.map(market => {
          const here = market.country === current?.country;
          return (
            <Link key={market.country} href={`/${market.country.toLowerCase()}`} aria-current={here ? "page" : undefined} className={`${row} ${here ? "bg-navy-50" : ""}`}>
              <Flag country={market.country} className="h-5 w-7.5" />
              <span className="grid min-w-0 flex-1">
                <span className="truncate">{market.name}</span>
                <span className="text-xs font-medium text-navy-500">{listingCount(market.listings)}</span>
              </span>
              {here ? <Check className="size-5 text-brand-700" aria-hidden="true" /> : null}
            </Link>
          );
        })}
        <Link href="/" aria-current={current ? undefined : "page"} className={`${row} mt-1 border-t border-navy-100 pt-1`}>
          <Globe2 className="size-5 text-navy-600" aria-hidden="true" />
          <span className="flex-1">All countries</span>
          {current ? null : <Check className="size-5 text-brand-700" aria-hidden="true" />}
        </Link>
      </nav>
    </Dropdown>
  );
}
