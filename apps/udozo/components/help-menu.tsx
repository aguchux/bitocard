"use client";

import Link from "next/link";
import { ChevronDown, CircleHelp, HelpCircle, LifeBuoy, Mail, MapPin, Package, ShieldCheck, Store } from "lucide-react";
import { type HelpIcon, helpLinks } from "@/lib/help";
import { Dropdown } from "./dropdown";

const icons: Record<HelpIcon, typeof LifeBuoy> = { help: LifeBuoy, shield: ShieldCheck, package: Package, questions: CircleHelp, store: Store, pickup: MapPin, mail: Mail };

/**
 * The header's **Get help** button (the icon alone on phones) and its menu, dropped from the button with a pointer
 * joining them: Help Centre, UdozoPay, Track orders, FAQs, Resell on Udozo, Pickup centres and Contact us. What is not
 * open yet is shown, marked Soon, and is not a link. It closes on choosing, on Escape and on a click outside.
 */
export function HelpMenu() {
  const row = "flex min-h-12 items-center gap-3 rounded-xl px-3 py-1.5";
  return (
    <Dropdown>
      <summary
        className="inline-flex min-h-11 shrink-0 cursor-pointer list-none items-center gap-1.5 rounded-xl px-2 text-[15px] font-semibold whitespace-nowrap text-navy-900 hover:bg-navy-50 sm:px-3 [&::-webkit-details-marker]:hidden [[open]>&]:bg-navy-50 [[open]>&_.chevron]:rotate-180"
        aria-label="Get help"
      >
        <HelpCircle className="size-5 text-brand-700" aria-hidden="true" />
        <span className="hidden sm:inline">Get help</span>
        <ChevronDown className="chevron hidden size-4 transition-transform duration-200 sm:block" aria-hidden="true" />
      </summary>
      <nav aria-label="Get help" className="menu-drop absolute right-4 z-30 mt-2.5 w-72 max-w-[calc(100vw-2rem)] origin-top-right sm:right-auto sm:left-1/2 sm:-translate-x-1/2">
        {/* The pointer joining the menu to its button, from tablets up (on phones the menu sits against the header's edge). */}
        <span className="absolute -top-1.5 left-1/2 -ml-1.5 hidden size-3 rotate-45 rounded-tl-[3px] border-t border-l border-navy-200 bg-white sm:block" aria-hidden="true" />
        <ul className="relative grid max-h-[calc(100dvh-6rem)] gap-0.5 overflow-y-auto rounded-2xl border border-navy-200 bg-white p-2 text-[15px] text-navy-900 shadow-lg">
          {helpLinks.map(link => {
            const Icon = icons[link.icon];
            const body = (
              <>
                <Icon className={`size-5 shrink-0 ${link.href ? "text-brand-700" : "text-navy-300"}`} aria-hidden="true" />
                <span className="grid min-w-0 flex-1">
                  <span className="font-semibold">{link.label}</span>
                  <span className="truncate text-xs text-navy-500">{link.hint}</span>
                </span>
                {link.href ? null : <span className="rounded-full bg-navy-50 px-2 py-0.5 text-[11px] font-bold tracking-wide text-navy-500 uppercase">Soon</span>}
              </>
            );
            return (
              <li key={link.label}>
                {link.href ? (
                  <Link href={link.href} className={`${row} hover:bg-navy-50`}>
                    {body}
                  </Link>
                ) : (
                  <span className={`${row} cursor-not-allowed text-navy-400`} aria-disabled="true">
                    {body}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </Dropdown>
  );
}
