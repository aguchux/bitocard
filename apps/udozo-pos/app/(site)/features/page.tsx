import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Features",
  description: "How Udozo POS works: tick Sell at POS on udozo.com, sign up with your Udozo account and sell in your shop with one stock count, staff PINs, receipts and reports.",
  alternates: { canonical: "/features" },
};

const steps = [
  { title: "Tick Sell at POS on udozo.com", body: "List products as you do today, with their category, price and how many you have. Tick the ones you also sell in your shop." },
  { title: "Sign up with your Udozo account", body: "Choose a plan and set up your shop. Products ticked Sell at POS come to your till with the same stock." },
  { title: "Invite your team and sell", body: "Add cashiers, managers and your accountant. They sign in with a PIN, without seeing your Udozo account." },
];

const features = [
  { title: "One stock count", body: "Shop sales and online orders take from the same number, so they never drift. Sold-out items pause on udozo.com by themselves." },
  { title: "Fast checkout", body: "Scan or tap, then take cash with change worked out, a transfer or a card, or split one sale across them. VAT is worked out for you." },
  { title: "Staff and roles", body: "Cashiers, managers, stock keepers and accountants each see only what they need, and sign in with their own PIN. Your Udozo account stays yours." },
  { title: "Receipts by print, WhatsApp and email", body: "Print on a receipt printer, or let the customer scan a code to get their receipt on WhatsApp." },
  { title: "Reports for your accountant", body: "Daily totals, shifts and cash-up, best sellers and stock value, with exports for bookkeeping." },
  { title: "Keeps selling offline", body: "A linked till keeps taking cash and recorded sales when the internet drops, and uploads them when it is back." },
];

function StartCta() {
  return (
    <section className="mx-auto max-w-[1200px] px-4 py-16 text-center sm:px-6">
      <h2 className="font-display text-3xl font-bold text-pos-ink">Ready to open your till?</h2>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/signup" className="flex h-12 items-center rounded-xl bg-pos-600 px-6 font-bold text-white no-underline hover:bg-pos-700">
          Start free
        </Link>
        <Link href="/pricing" className="flex h-12 items-center rounded-xl border border-pos-600 px-6 font-semibold text-pos-700 no-underline hover:bg-pos-50">
          See the plans
        </Link>
      </div>
    </section>
  );
}

/** How Udozo POS works and what it does, on a page of its own. */
export default function FeaturesPage() {
  return (
    <>
      <section className="bg-pos-night text-white">
        <div className="mx-auto max-w-[1200px] px-4 py-14 text-center sm:px-6">
          <h1 className="font-display text-4xl font-bold text-balance sm:text-5xl">Built around how you already sell</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-pos-night-text">Your udozo.com listings become your till, with the same categories and the same stock.</p>
        </div>
      </section>

      <section aria-labelledby="how" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <h2 id="how" className="text-center font-display text-3xl font-bold text-pos-ink">
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

      <section aria-labelledby="features-title" className="bg-pos-page">
        <div className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
          <h2 id="features-title" className="text-center font-display text-3xl font-bold text-pos-ink">
            Everything the counter needs
          </h2>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map(feature => (
              <li key={feature.title} className="flex flex-col gap-2 rounded-[20px] bg-white p-6">
                <h3 className="font-display text-lg font-bold text-pos-ink">{feature.title}</h3>
                <p className="text-pos-ink-2">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <StartCta />
    </>
  );
}
