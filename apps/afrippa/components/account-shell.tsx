import type { ReactNode } from "react";
import { globalMarket } from "@afrippa/ui/market";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { Header } from "@/components/header";

/** The signed-in places, as underlined tabs. */
const places = [
  { href: "/orders", label: "Orders" },
  { href: "/wallets", label: "Wallets" },
  { href: "/ads", label: "My ads" },
  { href: "/payment-methods", label: "Payment methods" },
  { href: "/security", label: "Security" },
  { href: "/trust", label: "Trust and safety" },
];

/** A signed-in page: the header, its title (and an action beside it), the account's tabs, then the page. */
export function AccountShell({ title, current, action, children }: { title: string; current: string; action?: ReactNode; children: ReactNode }) {
  return (
    <>
      <Header current={globalMarket} />
      <main id="main" className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-extrabold text-navy-900 sm:text-3xl">{title}</h1>
          {action}
        </div>
        <UnderlineTabs label="Your account" tabs={places} current={current} />
        {children}
      </main>
    </>
  );
}
