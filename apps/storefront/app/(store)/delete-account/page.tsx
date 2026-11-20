import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { legalContact } from "@bitocard/ui/legal";
import { appUrl } from "@bitocard/ui/site";
import { storeSubdomain } from "@/lib/store";

/**
 * How to delete a BitoCard account, public for the app stores (Google Play asks for a web page; docs/BITOCARD_MOBILE_APP_PLAN.md,
 * phase 5; `#some-data` is Play's "delete some data without deleting the account"). bitocard.com only: a reseller's store has its own customers and no app of ours.
 */
export const metadata: Metadata = {
  title: "Delete your BitoCard account",
  description: "How to delete your BitoCard account, or only some of your data, in the app or by email, and what we keep.",
  alternates: { canonical: "/delete-account" },
};

export default async function DeleteAccountPage() {
  if (await storeSubdomain()) notFound();
  return (
    <div className="mx-auto grid max-w-2xl gap-5 py-6 sm:py-12">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-navy-900 sm:text-4xl">Delete your BitoCard account</h1>
        <p className="mt-2 text-slate-600">You can delete your account yourself in BitoCard&apos;s app, or ask us to.</p>
      </div>
      <section className="grid gap-3 rounded-3xl border border-slate-100 bg-white p-6 text-slate-700 shadow-sm sm:p-8">
        <h2 className="font-display text-xl font-bold text-navy-900">In the app</h2>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Open BitoCard&apos;s app and sign in.</li>
          <li>Go to Account, then Settings, then Delete your account.</li>
          <li>Enter your password, type DELETE and confirm.</li>
        </ol>
        <p>It happens at once and cannot be undone. You can sign up again later, as a new account.</p>
        <h2 className="mt-2 font-display text-xl font-bold text-navy-900">By email</h2>
        <p>
          Email <a className="font-semibold text-pink-600 underline" href={`mailto:${legalContact}?subject=Delete%20my%20BitoCard%20account`}>{legalContact}</a> from the address you sign in with. We delete your account details within 30 days.
        </p>
        <h2 className="mt-2 font-display text-xl font-bold text-navy-900">What is deleted, and what we keep</h2>
        <p>Your name, email address, mobile numbers and password are removed, you are signed out everywhere and your phones are forgotten.</p>
        <p>
          The law makes us keep your orders, payments and their accounting (usually for six years), with no name or contact details on the account. While your wallet still holds money, or an order, sale, trade, deposit or payout is still open, the account cannot be deleted until that is settled. See our{" "}
          <a className="font-semibold text-pink-600 underline" href={appUrl("legals", "/documents/privacy#retention")}>privacy notice</a>.
        </p>
      </section>
      <section id="some-data" className="grid scroll-mt-24 gap-3 rounded-3xl border border-slate-100 bg-white p-6 text-slate-700 shadow-sm sm:p-8">
        <h2 className="font-display text-xl font-bold text-navy-900">Delete some of your data and keep your account</h2>
        <p>You can remove some things yourself, in the app or on bitocard.com:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Mobile numbers you added: Account, then Profile, then remove the number (your main number stays).</li>
          <li>Wallets you added in another currency, once they are empty: Wallet, then Remove.</li>
        </ul>
        <p>
          For anything else, email{" "}
          <a className="font-semibold text-pink-600 underline" href={`mailto:${legalContact}?subject=Delete%20some%20of%20my%20BitoCard%20data`}>{legalContact}</a>{" "}
          from the address you sign in with and tell us what you want deleted. We reply within 30 days and delete what the law lets us.
        </p>
        <p>
          We cannot delete records the law makes us keep while you have an account: your orders, payments and their accounting, and your identity check. We tell you which of what you asked for we have to keep, and why.
        </p>
      </section>
    </div>
  );
}
