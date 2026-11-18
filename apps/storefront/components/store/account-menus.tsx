"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, LogIn, ShoppingBag, Store, UserPlus } from "lucide-react";

/** Where each door leads: the store's own customer pages, and Seller HQ's for resellers (worked out on the server). */
export type AccountDoors = {
  customerSignIn: string;
  customerSignUp: string;
  resellerSignIn: string;
  resellerSignUp: string;
  /** The reseller landing page, to read before registering. */
  resellerInfo: string;
};

type Choice = { href: string; title: string; detail: string; icon: ReactNode };

/** What each menu offers, and where it leads. */
export function doorChoices(doors: AccountDoors) {
  return {
    signIn: [
      { href: doors.customerSignIn, title: "Sign in as a customer", detail: "Your orders, wallet and account", kind: "customer" },
      { href: doors.resellerSignIn, title: "Sign in as a reseller", detail: "Seller HQ: your stores, prices and wallet", kind: "reseller" },
    ],
    register: [
      { href: doors.customerSignUp, title: "Register as a customer", detail: "Buy and sell gift cards, top-ups, bills and more", kind: "customer" },
      { href: doors.resellerSignUp, title: "Register as a reseller", detail: "Open your own store and sell to your customers", kind: "reseller" },
    ],
  } as const;
}

const iconFor = (kind: "customer" | "reseller") =>
  kind === "customer" ? <ShoppingBag className="size-5" aria-hidden="true" /> : <Store className="size-5" aria-hidden="true" />;

/** Sign in and Register, each a choice of customer or reseller (bitocard.com's own sites, signed out). */
export function AccountMenus({ doors }: { doors: AccountDoors }) {
  const choices = doorChoices(doors);
  return (
    <>
      <div className="hidden lg:block">
        <DoorMenu
          label="Sign in"
          tone="plain"
          icon={<LogIn className="size-4" aria-hidden="true" />}
          choices={choices.signIn.map(choice => ({ ...choice, icon: iconFor(choice.kind) }))}
        />
      </div>
      <div className="hidden sm:block">
        <DoorMenu
          label="Register"
          tone="brand"
          icon={<UserPlus className="size-4" aria-hidden="true" />}
          choices={choices.register.map(choice => ({ ...choice, icon: iconFor(choice.kind) }))}
          footer={{ href: doors.resellerInfo, label: "How reselling works" }}
        />
      </div>
    </>
  );
}

function DoorMenu({ label, tone, icon, choices, footer }: { label: string; tone: "plain" | "brand"; icon: ReactNode; choices: Choice[]; footer?: { href: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const button =
    tone === "brand"
      ? "bg-brand-500 text-white shadow-sm hover:bg-brand-600"
      : "border border-slate-200 bg-white text-navy-900 hover:border-slate-300";
  return (
    <div ref={root} className="relative" onKeyDown={event => event.key === "Escape" && setOpen(false)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`flex min-h-11 items-center gap-2 rounded-xl px-4 text-[15px] font-semibold whitespace-nowrap ${button}`}
      >
        {icon}
        {label}
        <ChevronDown className={`size-4 transition-transform ${open ? "rotate-180" : ""} ${tone === "brand" ? "text-white/80" : "text-slate-500"}`} aria-hidden="true" />
      </button>
      {open ? (
        <div role="menu" aria-label={label} className="absolute top-[calc(100%+8px)] right-0 z-40 w-80 rounded-2xl border border-slate-200 bg-white p-1.5 text-navy-900 shadow-2xl">
          {choices.map(choice => (
            <Link key={choice.title} role="menuitem" href={choice.href} onClick={() => setOpen(false)} className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 no-underline hover:bg-slate-50">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">{choice.icon}</span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{choice.title}</span>
                <span className="block text-sm text-slate-500">{choice.detail}</span>
              </span>
            </Link>
          ))}
          {footer ? (
            <Link role="menuitem" href={footer.href} onClick={() => setOpen(false)} className="mt-1 flex min-h-10 items-center border-t border-slate-100 px-3 pt-1.5 text-sm font-semibold text-brand-600 no-underline hover:text-brand-700">
              {footer.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
