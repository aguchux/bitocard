import type { Metadata } from "next";
import { AccountNav } from "@/components/account/nav";
import { SiteFooter } from "@/components/footer";
import { SiteHeader } from "@/components/header";
import { accountCounts, marketOf } from "@/lib/account";
import { markets } from "@/lib/api";
import { confirmationPending, currentCustomer } from "@/lib/customer";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The seller's area (`/account/*`) and posting (`/sell`): Udozo's header in the customer's own market, then the
 * account's places beside the page (tabs above it on phones). Signed out, the pages send people to sign in themselves.
 */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const [customer, all] = await Promise.all([currentCustomer(), markets()]);
  const market = await marketOf(customer);
  const counts = customer && !confirmationPending(customer) ? await accountCounts() : null;
  return (
    <>
      <SiteHeader market={market ?? (all.showcase ? null : (all.data[0] ?? null))} customer={customer} showcase={all.showcase} />
      <div className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-10 sm:px-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:pt-8">
        {counts ? <AccountNav counts={counts} /> : <span className="hidden lg:block" />}
        <main className="min-w-0 pt-4 lg:pt-0">{children}</main>
      </div>
      <SiteFooter />
    </>
  );
}
