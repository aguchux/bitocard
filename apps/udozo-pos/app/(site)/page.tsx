import type { Metadata } from "next";
import Link from "next/link";
import { AppButtons } from "@/components/app-buttons";
import { PlanCards } from "@/components/plan-cards";
import { marketFor, posApps, publicPlans } from "@/lib/pos-data";
import { currentCustomer } from "@/lib/session";
import { udozoUrl } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const steps = [
  { title: "Tick Sell at POS on udozo.com", body: "List products as you do today, with their category, price and how many you have. Tick the ones you also sell in your shop." },
  { title: "Sign up with your Udozo account", body: "Choose a plan and set up your shop. Products ticked Sell at POS come to your till with the same stock." },
  { title: "Invite your team and sell", body: "Add cashiers, managers and your accountant. They sign in with a PIN, without seeing your Udozo account." },
];

const features: Array<{ title: string; body: string; soon?: boolean }> = [
  { title: "One stock count", body: "Shop sales and online orders take from the same number, so they never drift. Sold-out items pause on udozo.com by themselves." },
  { title: "Fast checkout", body: "Scan or tap, then take cash, transfer, card or a Udozo wallet payment, or split one sale across them. VAT is worked out for you." },
  { title: "Staff and roles", body: "Cashiers, managers, stock keepers and accountants each see only what they need. Your Udozo account stays yours." },
  { title: "Receipts by print, WhatsApp and email", body: "Print on a receipt printer, or let the customer scan a code to get their receipt on WhatsApp.", soon: true },
  { title: "Reports for your accountant", body: "Daily totals, cash-up, best sellers and stock value, with exports for bookkeeping.", soon: true },
  { title: "Keeps selling offline", body: "The till keeps taking cash and recorded sales when the internet drops, and uploads them when it is back.", soon: true },
];

const questions = [
  { q: "Do I need a udozo.com account?", a: "Yes: the shop owner signs up with their Udozo account, which is free. Your staff do not need one; they get a PIN." },
  { q: "Can I sell items that are not shown online?", a: "Yes. Add them on udozo.com, tick Sell at POS and set them to shop only." },
  { q: "What equipment do I need?", a: "Any phone, tablet or computer with a browser. Receipt printers and barcode scanners are optional." },
  { q: "How do I pay for a plan?", a: "From your Udozo wallet, which you top up on udozo.com by card, bank transfer or mobile money. Free needs no payment." },
  { q: "Can I cancel?", a: "At any time, from Billing. A paid plan runs to the end of its month, then your shop moves to Free, and your udozo.com listings keep working as before." },
];

/** pos.udozo.com's home: the public, indexed page for shop owners, with the POS itself behind sign-in. */
export default async function Home({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const customer = await currentCustomer();
  const country = marketFor(customer?.country, (await searchParams).country);
  const [plans, apps] = await Promise.all([publicPlans(country), posApps()]);
  const trial = Math.max(0, ...(plans?.data ?? []).filter(plan => plan.paid).map(plan => plan.trial_days));
  return (
    <>
      <section className="bg-pos-night text-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-12 px-4 pt-10 pb-20 sm:px-6 sm:pt-14">
          <div className="flex min-w-0 flex-[1_1_460px] flex-col gap-5">
            <span className="self-start rounded-full bg-pos-night-2 px-3 py-1.5 text-[13px] font-bold text-[#8FE0C2]">For udozo.com sellers with a physical shop</span>
            <h1 className="font-display text-4xl leading-[1.05] font-bold text-balance sm:text-[56px]">The till that already knows your Udozo stock</h1>
            <p className="max-w-[540px] text-lg leading-relaxed text-pos-night-text">
              Sign in with your Udozo account and the products you sell in your shop come to the till, with their categories and stock. Sell in the shop, and your online stock follows by itself.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="flex h-14 items-center rounded-[14px] bg-pos-500 px-6 text-[17px] font-bold text-white no-underline hover:bg-pos-600">
                {trial > 0 ? `Start your ${trial}-day free trial` : "Start free"}
              </Link>
              <Link href="/download" className="flex h-14 items-center rounded-[14px] border border-[#3C5E50] px-5 font-semibold text-white no-underline hover:bg-pos-night-2">
                Get the apps
              </Link>
            </div>
            <p className="text-sm text-pos-night-muted">A Free plan for small shops. You need a udozo.com account, which is free.</p>
          </div>
          <figure className="m-0 min-w-0 flex-[1_1_440px]">
            <div aria-hidden="true" className="flex gap-3 rounded-[22px] bg-pos-page p-4 text-pos-ink shadow-2xl">
              <div className="grid flex-[1.4] grid-cols-2 gap-2.5">
                {[
                  ["Wireless Earbuds Pro", "₦18,500", "#E3EEFB"],
                  ["USB-C Charger 25W", "₦7,500", "#FDEFD9"],
                  ["Power Bank 20,000", "Only 6 left", "#E6F3EE"],
                  ["Lightning Cable 1m", "₦3,500", "#EFE8FA"],
                ].map(([name, price, tint]) => (
                  <div key={name} className="flex flex-col gap-1.5 rounded-xl bg-white p-2.5">
                    <div className="h-14 rounded-lg" style={{ background: tint }} />
                    <span className="text-xs font-semibold">{name}</span>
                    <span className={`text-[13px] font-bold ${price.startsWith("Only") ? "text-pos-warn" : ""}`}>{price}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-1 flex-col gap-2 rounded-xl bg-white p-3 text-xs">
                <span className="text-sm font-bold">Current sale</span>
                <span className="flex justify-between">
                  <span>Earbuds Pro</span>
                  <span>18,500</span>
                </span>
                <span className="flex justify-between">
                  <span>Charger ×2</span>
                  <span>15,000</span>
                </span>
                <span className="mt-auto flex justify-between border-t border-pos-line pt-2 text-sm font-bold">
                  <span>Total</span>
                  <span>₦36,012.50</span>
                </span>
                <span className="rounded-lg bg-pos-600 py-2 text-center font-bold text-white">Charge</span>
              </div>
            </div>
            <figcaption className="mt-2 text-xs text-pos-night-muted">An illustration of the till.</figcaption>
          </figure>
        </div>
      </section>

      <section aria-labelledby="how" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <h2 id="how" className="font-display text-3xl font-bold text-pos-ink">
          Open your till in three steps
        </h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-col gap-3 rounded-[20px] border border-pos-line bg-white p-6">
              <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-full bg-pos-50 font-display text-lg font-bold text-pos-700">
                {index + 1}
              </span>
              <h3 className="font-display text-xl font-bold text-pos-ink">{step.title}</h3>
              <p className="text-pos-ink-2">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section id="features" aria-labelledby="features-title" className="bg-pos-page">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <h2 id="features-title" className="font-display text-3xl font-bold text-pos-ink">
            Built around how you already sell
          </h2>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(feature => (
              <li key={feature.title} className="flex flex-col gap-2 rounded-[20px] bg-white p-6">
                <h3 className="font-display text-lg font-bold text-pos-ink">{feature.title}</h3>
                <p className="text-pos-ink-2">{feature.body}</p>
                {feature.soon ? <span className="self-start rounded-md bg-pos-warn-bg px-2 py-0.5 text-xs font-semibold text-pos-warn">Coming soon</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="apps" aria-labelledby="apps-title" className="bg-pos-night text-white">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <h2 id="apps-title" className="font-display text-3xl font-bold">
            On the counter, on your phone, in the browser
          </h2>
          <p className="mt-3 max-w-2xl text-pos-night-text">Open pos.udozo.com on any phone, tablet or computer. Apps for Android, iPhone and Windows are on their way, with one sign-in everywhere.</p>
          <div className="mt-8">
            <AppButtons apps={apps} />
          </div>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <h2 id="pricing-title" className="font-display text-3xl font-bold text-pos-ink">
          Simple monthly plans
        </h2>
        <p className="mt-3 text-pos-ink-2">
          Paid plans come from your Udozo wallet each month. <Link href="/pricing">Compare the plans</Link>.
        </p>
        <div className="mt-8">
          <PlanCards plans={plans?.data ?? []} />
        </div>
        <p className="mt-4 text-sm text-pos-muted">Plan fees are separate from udozo.com&apos;s fees on online orders.</p>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="bg-pos-page">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 id="faq-title" className="font-display text-3xl font-bold text-pos-ink">
            Questions
          </h2>
          <div className="mt-6 grid gap-3">
            {questions.map(item => (
              <details key={item.q} className="rounded-2xl bg-white p-5">
                <summary className="font-semibold text-pos-ink">{item.q}</summary>
                <p className="mt-2 text-pos-ink-2">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1200px] px-4 py-16 text-center sm:px-6">
        <h2 className="font-display text-3xl font-bold text-pos-ink">Ready to open your till?</h2>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="flex h-12 items-center rounded-xl bg-pos-600 px-6 font-bold text-white no-underline hover:bg-pos-700">
            Start free
          </Link>
          <Link href="/signin" className="flex h-12 items-center rounded-xl border border-pos-600 px-6 font-semibold text-pos-700 no-underline hover:bg-pos-50">
            Sign in
          </Link>
        </div>
        <p className="mt-4 text-sm text-pos-muted">
          No Udozo account yet? <a href={udozoUrl("/signup")}>Create one free on udozo.com</a>.
        </p>
      </section>
    </>
  );
}
