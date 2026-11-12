import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Trash2 } from "lucide-react";
import { deletionKeeps, deletionRemoves, deletionScreen, deletionWaits } from "@/lib/account-deletion";

export const metadata: Metadata = {
  title: "Delete your Udozo account",
  description: "How to delete your Udozo account, in the app or on udozo.com, what is removed and what the law makes us keep.",
  alternates: { canonical: "/help/delete-account" },
};

/** How to delete a Udozo account (the page Google Play links to), for anyone, signed in or not. */
export default function DeleteAccountHelpPage() {
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 pt-5 pb-10">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-navy-600">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span>Help</span>
        <ChevronRight className="size-4" aria-hidden="true" />
        <span aria-current="page" className="font-semibold text-brand-700">
          Delete your account
        </span>
      </nav>
      <header className="grid gap-2">
        <h1 className="text-3xl font-extrabold tracking-tight text-navy-900">Delete your Udozo account</h1>
        <p className="text-navy-600">You can delete your account yourself at any time, in Udozo&apos;s app or here on udozo.com. It happens at once and cannot be undone.</p>
      </header>
      <section aria-labelledby="how" className="grid gap-3">
        <h2 id="how" className="text-lg font-bold text-navy-900">
          How
        </h2>
        <ol className="grid list-decimal gap-2 pl-5 text-navy-700">
          <li>In the app: Me, then Settings, then Delete my account.</li>
          <li>On udozo.com: sign in, open Profile, then Delete your account.</li>
          <li>Type DELETE (and your password, if your account has one) and confirm.</li>
        </ol>
        <Link href={deletionScreen} className="inline-flex min-h-11 w-fit items-center gap-2 rounded-xl border border-navy-200 bg-white px-4 font-semibold hover:border-navy-300">
          <Trash2 className="size-4" aria-hidden="true" /> Delete my account
        </Link>
      </section>
      <section aria-labelledby="removed" className="grid gap-3">
        <h2 id="removed" className="text-lg font-bold text-navy-900">
          What is removed
        </h2>
        <ul className="grid list-disc gap-1 pl-5 text-navy-700">
          {deletionRemoves.map(item => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-navy-700">{deletionKeeps}</p>
        <p className="text-navy-700">{deletionWaits}</p>
      </section>
      <p className="text-sm text-navy-600">
        Cannot sign in? Write to us from{" "}
        <Link href="/help/contact" className="font-semibold underline">
          Contact us
        </Link>{" "}
        and we will close it for you within 30 days. More in our{" "}
        <Link href="/legal/privacy#app" className="font-semibold underline">
          privacy notice
        </Link>
        .
      </p>
    </div>
  );
}
