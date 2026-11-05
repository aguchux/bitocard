import type { Metadata } from "next";
import Link from "next/link";
import { AccountNav } from "@/components/account/nav";
import { RailBanner } from "@/components/account/rail-banner";
import { UsernameBanner } from "@/components/account/username-banner";
import { MicrophonePrompt } from "@/components/calls/microphone-prompt";
import { SiteFooter } from "@/components/footer";
import { SiteHeader } from "@/components/header";
import { accountCounts, marketOf } from "@/lib/account";
import { markets } from "@/lib/api";
import { bannersFor, pickBanner } from "@/lib/banners";
import {
  confirmationPending,
  currentCustomer,
  customerApi,
  mobileToConfirm,
  siteOrigin,
} from "@/lib/customer";
import { bannerShown } from "@/lib/username";
import { sellerPath, type UsernameStatus } from "@bitocard/api-client/classifieds";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The seller's area (`/account/*`) and posting (`/sell`): Udozo's header in the customer's own market, then the
 * account's places beside the page (tabs above it on phones), and the microphone prompt for calls. Signed out, the pages
 * send people to sign in themselves.
 */
export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [customer, all] = await Promise.all([currentCustomer(), markets()]);
  const market = await marketOf(customer);
  const signedIn = customer && !confirmationPending(customer);
  // The username ask is read with the rest; when it cannot be, there is simply no banner.
  const [counts, banners, username] = signedIn
    ? await Promise.all([
        accountCounts(),
        bannersFor("account_rail", market?.country ?? customer.country),
        customerApi<UsernameStatus>("GET", "/v1/store/account/username"),
      ])
    : [null, [], null];
  const banner = pickBanner(banners);
  return (
    <>
      <SiteHeader
        market={market ?? (all.showcase ? null : (all.data[0] ?? null))}
        customer={customer}
        showcase={all.showcase}
      />
      <div className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-10 sm:px-6 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8 lg:px-8 lg:pt-8">
        {counts ? (
          <AccountNav
            counts={counts}
            banner={banner ? <RailBanner banner={banner} /> : null}
          />
        ) : (
          <span className="hidden lg:block" />
        )}
        <main className="min-w-0 pt-4 lg:pt-0">
          {customer &&
          !customer.name_confirmed &&
          !confirmationPending(customer) ? (
            <p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Please check your first and last name, as on your ID.{" "}
              <Link
                href="/account/profile#you"
                className="font-semibold underline"
              >
                Check my name
              </Link>
            </p>
          ) : null}
          {customer &&
          !confirmationPending(customer) &&
          mobileToConfirm(customer) ? (
            <p className="mb-4 rounded-xl bg-navy-50 p-3 text-sm text-navy-800">
              Your mobile number is not confirmed yet. Calls, call backs and
              some purchases need it.{" "}
              <Link
                href="/account/profile#phone"
                className="font-semibold underline"
              >
                Confirm my mobile
              </Link>
            </p>
          ) : null}
          {customer && username?.ok && bannerShown(username.data) ? (
            <UsernameBanner
              example={`${new URL(siteOrigin()).host}${sellerPath(customer.country ?? "ng", "yourname")}`}
            />
          ) : null}
          {children}
          {/* Signed in and confirmed: ask for the microphone where calls are set up and it is not allowed yet. */}
          {counts ? <MicrophonePrompt /> : null}
        </main>
      </div>
      <SiteFooter />
    </>
  );
}
