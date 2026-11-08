import type { Metadata } from "next";
import Link from "next/link";
import { LegalFrame } from "@/components/legal";
import { shopApi } from "@/lib/api";

export const metadata: Metadata = {
  title: "Deleting your Facebook data",
  description: "What Udozo keeps from Facebook, how to have it deleted, and where your deletion request stands.",
  alternates: { canonical: "/legal/facebook-deletion" },
  robots: { index: false, follow: true },
};

type Deletion = { confirmation_code: string; status: "completed" | "pending"; requested_at: string; completed_at: string | null };

const day = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" });

/** A confirmation code as Meta shows it: letters and digits only. */
const deletionCode = (value: unknown) => (typeof value === "string" && /^[A-Za-z0-9]{6,32}$/.test(value) ? value.toUpperCase() : null);

/**
 * Meta's data deletion page for "Continue with Facebook": where a request made through Facebook stands (by the
 * confirmation code Meta showed, `?code=`), and the instructions for anyone who wants Udozo to forget their Facebook
 * account. Linked from the API's data deletion callback; usable as the Meta app's data deletion instructions page too.
 */
export default async function FacebookDeletionPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const code = deletionCode((await searchParams).code);
  const found = code ? await shopApi<Deletion>(`/v1/facebook/data-deletion/${code}`, { revalidate: 0 }) : null;
  return (
    <LegalFrame current={null}>
      <article className="grid gap-6">
        <header className="grid gap-2">
          <p className="text-sm font-semibold text-brand-700">Udozo</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Deleting your Facebook data</h1>
        </header>

        {code ? (
          <section aria-labelledby="request" className="grid gap-2 rounded-2xl bg-navy-50 p-5 ring-1 ring-navy-200">
            <h2 id="request" className="text-lg font-bold">
              Your request {code}
            </h2>
            {found?.ok ? (
              <p>
                {found.data.status === "completed"
                  ? `Done. We removed your Facebook account from Udozo on ${day.format(new Date(found.data.completed_at ?? found.data.requested_at))} (UTC).`
                  : "We have your request and are working on it."}
              </p>
            ) : found && found.status === 404 ? (
              <p>We have no request with that confirmation code. Check the code Facebook showed you.</p>
            ) : (
              <p>We cannot check this request right now. Try again shortly.</p>
            )}
          </section>
        ) : null}

        <section className="grid gap-3">
          <h2 className="text-lg font-bold">What we keep from Facebook</h2>
          <p>
            When you continue with Facebook on udozo.com or Seller HQ, Facebook tells us your name and email address, and we keep the ID Facebook gives Udozo for your account so we can
            recognise it next time. We never get your Facebook password and we ask Facebook for nothing else.
          </p>
          <h2 className="text-lg font-bold">How to have it deleted</h2>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>
              On Facebook, open Settings and privacy, then Settings, then Apps and websites, choose Udozo and remove it. Facebook then tells us, and we remove your Facebook ID from Udozo at once.
              If you also ask Facebook to delete your data, it shows you a confirmation code you can check on this page.
            </li>
            <li>
              Or write to us from <Link href="/help/contact" className="font-semibold text-brand-700 underline">Contact us</Link> and we will remove it for you.
            </li>
          </ul>
          <p>
            Your Udozo account stays yours: sign in with your email address (Forgot password sets a password if you made the account with Facebook). To close the account and delete
            what it holds, contact us; our <Link href="/legal/privacy" className="font-semibold text-brand-700 underline">privacy notice</Link> says what we keep and for how long.
          </p>
        </section>
      </article>
    </LegalFrame>
  );
}
