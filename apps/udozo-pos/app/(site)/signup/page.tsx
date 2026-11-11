import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupWizard } from "@/components/signup-wizard";
import { currentOwner } from "@/lib/pos-data";
import { currentCustomer } from "@/lib/session";
import { signInPath, udozoUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Start free", robots: { index: false, follow: true } };

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[20px] border border-pos-line bg-white p-6">
      <h2 className="font-display text-2xl font-bold text-pos-ink">{title}</h2>
      <div className="mt-2 grid gap-3 text-pos-ink-2">{children}</div>
    </section>
  );
}

/**
 * Sign-up, the owner only: connect the Udozo account (udozo.com's handoff), then the shop, the plan and what is due
 * today from the Udozo wallet. Someone already signed up goes to their POS.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const back = `/signup${plan && /^[a-z_]{1,20}$/.test(plan) ? `?plan=${plan}` : ""}`;
  const customer = await currentCustomer();
  let body: React.ReactNode;
  if (!customer) {
    body = (
      <Card title="Connect your Udozo account">
        <p>Udozo POS uses your udozo.com listings, categories and stock. You sign in to the POS with this account as the shop owner.</p>
        <a href={signInPath(back)} className="flex h-12 items-center justify-center rounded-xl bg-pos-600 font-bold text-white no-underline hover:bg-pos-700 sm:justify-self-start sm:px-6">
          Continue with Udozo
        </a>
        <p className="text-sm text-pos-muted">
          Not on udozo.com yet? <a href={udozoUrl("/signup")}>Create a free account</a>, then come back here.
        </p>
        <div className="mt-2 grid gap-2 rounded-2xl bg-pos-page p-4 text-sm sm:grid-cols-2">
          <div>
            <p className="font-semibold text-pos-ink">Udozo POS can</p>
            <ul className="mt-1 grid gap-1">
              <li>✓ Read your listings, categories and stock</li>
              <li>✓ Update stock after shop sales</li>
              <li>✓ Take the monthly plan from your Udozo wallet</li>
            </ul>
          </div>
          <div>
            <p className="font-semibold text-pos-ink">It cannot</p>
            <ul className="mt-1 grid gap-1">
              <li>✕ See or move your payouts</li>
              <li>✕ Change your bank details or password</li>
            </ul>
          </div>
        </div>
      </Card>
    );
  } else {
    const owner = await currentOwner();
    if (owner.ok && owner.data.account) redirect("/app");
    if (!owner.ok) {
      body =
        owner.code === "country_required" ? (
          <Card title="Choose your country on udozo.com first">
            <p>Your shop sells in your Udozo account&apos;s country and currency. Set your country on your udozo.com profile, then come back.</p>
            <a href={udozoUrl("/account/profile")} className="font-semibold">
              Open your udozo.com profile
            </a>
          </Card>
        ) : owner.code === "pos_unavailable" ? (
          <Card title="This account cannot open a POS">
            <p>{owner.message}</p>
          </Card>
        ) : (
          <Card title="Udozo cannot be reached">
            <p>{owner.message}</p>
            <Link href={back}>Try again</Link>
          </Card>
        );
    } else if (!owner.data.open) {
      body = (
        <Card title="Udozo POS is coming to your country">
          <p>Sign-up is not open in your country yet. We will tell you on udozo.com when it is.</p>
          <Link href="/pricing">See the plans</Link>
        </Card>
      );
    } else if (!customer.email_verified) {
      body = (
        <Card title="Confirm your email on udozo.com first">
          <p>Finish setting up your Udozo account, then come back to open your shop.</p>
          <a href={udozoUrl("/verify")} className="font-semibold">
            Confirm my email
          </a>
        </Card>
      );
    } else {
      body = <SignupWizard plans={owner.data.plans} currency={owner.data.currency} wallet={owner.data.wallet.balance} initialPlan={plan ?? null} addFundsUrl={udozoUrl("/account/wallet")} name={customer.name} />;
    }
  }
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="font-display text-4xl font-bold text-pos-ink">Open your till</h1>
      <p className="mt-2 mb-8 text-pos-ink-2">
        Already signed up? <Link href="/signin">Sign in</Link>.
      </p>
      {body}
    </div>
  );
}
