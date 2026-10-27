import type { ReactNode } from "react";
import { globalMarket } from "@bitocard/crypto-ui/market";
import { UnderlineTabs } from "@bitocard/ui/underline-tabs";
import { Header } from "@/components/header";
import type { AccountPlace } from "@/lib/account";

/** The signed-in places, as BitoCard's underlined tabs. */
const places = [
  { href: "/wallets", label: "Wallets" },
  { href: "/ads", label: "My ads" },
  { href: "/trades", label: "Trades" },
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

/**
 * A wallet page on the customer's account app (`/go/<place>` signs them in there and leaves this site): a plain link,
 * never a client-side navigation, since the route answers with a redirect to another site.
 */
export function AccountLink({ place, className, children }: { place: AccountPlace; className?: string; children: ReactNode }) {
  return (
    <a href={`/go/${place}`} className={className}>
      {children}
    </a>
  );
}
