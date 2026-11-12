import type { Metadata } from "next";
import Link from "next/link";
import { marketFor, publicPlans } from "@/lib/pos-data";
import { currentCustomer } from "@/lib/session";
import { udozoUrl } from "@/lib/site";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const pages = [
  { href: "/features", title: "How it works", body: "Tick Sell at POS on udozo.com, sign up with your Udozo account and sell with one stock count, staff PINs, receipts and reports." },
  { href: "/pricing", title: "Plans", body: "Start on Free, then move to Premium or Multi-shop when your shop grows. Paid monthly from your Udozo wallet." },
  { href: "/download", title: "Apps", body: "Use any browser today. Udozo POS for Windows, Android and iPhone, with one sign-in everywhere." },
  { href: "/faq", title: "Questions", body: "The Udozo account, shop-only items, the equipment you need, paying for a plan and cancelling." },
];

/** pos.udozo.com's home: the public, indexed page for shop owners, leading to the site's other pages. */
export default async function Home({ searchParams }: { searchParams: Promise<{ country?: string }> }) {
  const customer = await currentCustomer();
  const plans = await publicPlans(marketFor(customer?.country, (await searchParams).country));
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

      <section aria-labelledby="explore" className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6">
        <h2 id="explore" className="text-center font-display text-3xl font-bold text-pos-ink">
          Everything about Udozo POS
        </h2>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {pages.map(page => (
            <li key={page.href}>
              <Link href={page.href} className="flex h-full flex-col gap-2 rounded-[20px] border border-pos-line bg-white p-6 text-pos-ink no-underline hover:border-pos-600">
                <span className="font-display text-xl font-bold">{page.title}</span>
                <span className="text-pos-ink-2">{page.body}</span>
                <span className="mt-auto pt-2 font-semibold text-pos-700">
                  Read more <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="bg-pos-page">
        <div className="mx-auto max-w-[1200px] px-4 py-16 text-center sm:px-6">
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
        </div>
      </section>
    </>
  );
}
