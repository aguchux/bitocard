import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Plus } from "lucide-react";
import { sellerPath, type UsernameStatus } from "@bitocard/api-client/classifieds";
import { PageTitle } from "@/components/account/nav";
import { CopyAddress, UsernameForm } from "@/components/account/username-form";
import { requireCustomer } from "@/lib/account";
import { customerApi, siteOrigin } from "@/lib/customer";
import { changeAfterText, moreAdsText, usernameScreen } from "@/lib/username";

export const metadata: Metadata = { title: "Username" };

const card = "grid gap-3 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5";

/**
 * Profile > Username (docs/UDOZO_USERNAMES_PLAN.md): their username and their seller page's address with Copy; once they
 * have posted the market's minimum of ads, the field to choose or change it (checked as they type) with Udozo's
 * suggestions; before that, how many ads to go. Once set, when they can change it next (once every 30 days).
 */
export default async function UsernamePage() {
  const customer = await requireCustomer(usernameScreen);
  const status = await customerApi<UsernameStatus>("GET", "/v1/store/account/username");
  const cc = (customer.country ?? "ng").toLowerCase();
  const origin = siteOrigin();
  const host = new URL(origin).host;
  const addressPrefix = `${host}${sellerPath(cc, "")}`;
  const data = status.ok ? status.data : null;
  const next = data ? changeAfterText(data) : null;
  return (
    <div className="grid max-w-2xl gap-5">
      <Link href="/account/profile" className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-navy-700 hover:underline">
        <ChevronLeft className="size-4" aria-hidden="true" /> Profile
      </Link>
      <PageTitle title="Username" note="Your seller page's address: easier to share and to remember than random letters." post={false} />
      {!data ? (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Your username could not be loaded just now. Try again shortly.</p>
      ) : (
        <>
          <section aria-labelledby="current" className={card}>
            <h2 id="current" className="font-bold">
              {data.username ? "Your username" : "No username yet"}
            </h2>
            {data.username ? (
              <>
                <p className="text-lg font-extrabold break-all">{data.username}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a href={new URL(sellerPath(cc, data.username), origin).href} className="min-w-0 flex-1 basis-48 text-sm break-all text-brand-700 hover:underline">
                    {addressPrefix}
                    {data.username}
                  </a>
                  <CopyAddress url={new URL(sellerPath(cc, data.username), origin).href} />
                </div>
                <p className="text-sm text-navy-600">{next ?? "You can change it now. After a change, you can change it again in 30 days."}</p>
              </>
            ) : (
              <p className="text-sm text-navy-600">
                Your seller page&apos;s address is random letters until you choose one, then it becomes{" "}
                <strong className="break-all text-navy-900">{addressPrefix}yourname</strong>.
              </p>
            )}
          </section>
          {data.eligible && !next ? (
            <section aria-labelledby="choose" className={card}>
              <h2 id="choose" className="font-bold">
                {data.username ? "Change your username" : "Choose your username"}
              </h2>
              <UsernameForm current={data.username} addressPrefix={addressPrefix} />
              <p className="text-xs text-navy-500">
                It shows on your seller page and your listings. It may not pretend to be someone else, mislead, or carry contact details.{" "}
                <Link href="/legal/terms#listings" className="font-semibold underline">
                  The rules
                </Link>
              </p>
            </section>
          ) : !data.eligible && !data.username ? (
            <section aria-labelledby="choose" className={card}>
              <h2 id="choose" className="font-bold">
                {moreAdsText(data)}
              </h2>
              <p className="text-sm text-navy-600">
                You have posted {data.posted} of the {data.required} ads needed. Once you reach {data.required}, you can choose a username here.
              </p>
              <Link href="/sell" className="inline-flex h-10 w-fit items-center gap-1.5 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white hover:bg-brand-600">
                <Plus className="size-4" strokeWidth={2.6} aria-hidden="true" /> Post an ad
              </Link>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
