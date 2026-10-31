import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, ShieldCheck, Store } from "lucide-react";
import type { ShopMarket, ShopTopCategory } from "@bitocard/api-client/classifieds";
import { Flag } from "@/components/flag";
import { UdozoWordmark } from "@/components/header";
import { ShopIcon } from "@/components/icon";
import { markets } from "@/lib/api";
import { categoriesOf } from "@/lib/reference";
import { campaignOf, faqs, reasons, startLinks, steps } from "@/lib/start-here";

const title = "Start selling on Udozo: free to list, paid safely";
const description = "Sign up in two minutes and post your first listing free. Buyers near you pay with Safe pay, so the money is held until they have the item. Or open your own store with every feature, free.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/start-here" },
  openGraph: { title, description, url: "/start-here" },
  twitter: { title, description },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const where = (open: ShopMarket[]) => (open.length ? open.map(market => market.name).join(", ").replace(/, ([^,]*)$/, " and $1") : null);

/** The primary button: sign up, then post a listing. */
function SellButton({ href, label = "Start selling free", light = false }: { href: string; label?: string; light?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl px-6 text-base font-bold shadow-sm transition-colors ${light ? "bg-white text-navy-900 hover:bg-brand-50" : "bg-brand-500 text-white hover:bg-brand-600"}`}
    >
      {label} <ArrowRight className="size-5" aria-hidden="true" />
    </Link>
  );
}

/** A phone showing a listing and a Safe pay order, drawn in code; labelled as an illustration. */
function PhoneIllustration() {
  return (
    <figure className="relative mx-auto w-full max-w-[300px]" aria-label="Illustration of a listing on Udozo with a Safe pay order">
      <div className="rounded-[2.2rem] border-[10px] border-navy-950 bg-white shadow-2xl">
        <div className="mx-auto mt-2 h-1.5 w-16 rounded-full bg-navy-200" />
        <div className="grid gap-3 p-4">
          <div className="aspect-[4/3] rounded-2xl bg-gradient-to-br from-brand-100 via-white to-mint-50 p-3">
            <div className="flex h-full items-end justify-between">
              <span className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-navy-700">5 photos</span>
              <ShopIcon name="smartphone" className="size-14 text-navy-800" />
            </div>
          </div>
          <div className="grid gap-1">
            <p className="text-sm font-bold text-navy-900">Smartphone, 128 GB, like new</p>
            <p className="text-lg font-extrabold text-brand-600">Your price</p>
            <p className="text-xs text-navy-500">Near you · Posted today</p>
          </div>
          <div className="grid gap-2 rounded-2xl border border-mint-500/30 bg-mint-50 p-3">
            <p className="flex items-center gap-1.5 text-xs font-bold text-mint-700">
              <ShieldCheck className="size-4" aria-hidden="true" /> Safe pay order
            </p>
            <ol className="grid gap-1 text-[11px] text-navy-700">
              {["Buyer paid: Udozo holds it", "You hand it over", "Released to you"].map((item, i) => (
                <li key={item} className="flex items-center gap-1.5">
                  <span className={`grid size-4 place-items-center rounded-full text-[9px] font-bold ${i < 2 ? "bg-mint-500 text-white" : "border border-mint-500 text-mint-700"}`}>{i + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 text-center text-xs text-white/70">Illustration</figcaption>
    </figure>
  );
}

function Categories({ categories }: { categories: ShopTopCategory[] }) {
  if (!categories.length) return null;
  return (
    <section aria-labelledby="sell-anything" className="mx-auto grid max-w-6xl gap-5 px-4 sm:px-6">
      <div className="grid gap-1 text-center">
        <h2 id="sell-anything" className="text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
          Whatever you have, someone near you wants it
        </h2>
        <p className="text-navy-600">List in any of Udozo&apos;s categories.</p>
      </div>
      <ul className="flex flex-wrap justify-center gap-2.5">
        {categories.map(category => (
          <li key={category.slug} className="flex min-h-11 items-center gap-2 rounded-full border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-800">
            <ShopIcon name={category.icon} className="size-4.5 text-brand-600" /> {category.name}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Start here: where Udozo's marketers and ads send people to sign up and start selling. A focused page (Udozo's mark,
 * Sign in and the sign-up button, no other navigation): what selling on Udozo is, how Safe pay pays them, the two ways
 * to sell (their own things, or a store reselling suppliers' listings on Seller HQ), and answers, every button to
 * sign-up with the visit's referral and campaign tags (`lib/start-here.ts`). Indexed, so it also answers searches.
 */
export default async function StartHerePage({ searchParams }: Props) {
  const links = startLinks(campaignOf(await searchParams));
  const all = await markets();
  const open = all.data;
  const categories = open[0] ? await categoriesOf(open[0].country) : [];
  const places = where(open);
  return (
    <div className="bg-page">
      <header className="sticky top-0 z-20 border-b border-navy-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6">
          <UdozoWordmark />
          <nav aria-label="Start" className="ml-auto flex items-center gap-2">
            <Link href={links.signIn} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-navy-800 hover:bg-navy-50">
              Sign in
            </Link>
            <Link href={links.sell} className="inline-flex min-h-11 items-center rounded-xl bg-brand-500 px-4 text-sm font-bold text-white hover:bg-brand-600">
              Start selling
            </Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden bg-navy-900">
          <div aria-hidden="true" className="pointer-events-none absolute -top-32 -right-24 size-[28rem] rounded-full bg-brand-500/25 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-mint-500/20 blur-3xl" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.15fr_1fr] lg:py-20">
            <div className="grid gap-6">
              {places ? (
                <p className="inline-flex w-fit items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-white">
                  {open.slice(0, 4).map(market => (
                    <Flag key={market.country} country={market.country} />
                  ))}
                  Now open in {places}
                </p>
              ) : null}
              <h1 className="text-4xl leading-[1.05] font-extrabold tracking-tight text-white sm:text-5xl lg:text-6xl">
                Turn what you have into money.
                <span className="block text-brand-300">Start selling on Udozo today.</span>
              </h1>
              <p className="max-w-xl text-lg text-white/85">
                Post your first listing free in minutes. Buyers near you pay with Safe pay, so the money is held until they have the item, and then it is yours.
              </p>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <SellButton href={links.sell} />
                <Link href={links.store} className="inline-flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-white/30 px-6 text-base font-semibold text-white hover:bg-white/10">
                  <Store className="size-5" aria-hidden="true" /> Open your own store
                </Link>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-white/80">
                {["Free to list", "No setup fee", "Paid safely with Safe pay"].map(item => (
                  <li key={item} className="flex items-center gap-1.5">
                    <Check className="size-4 text-mint-500" aria-hidden="true" /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <PhoneIllustration />
          </div>
        </section>

        <div className="grid gap-16 py-14 sm:gap-20 sm:py-20">
          <section aria-labelledby="how" className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6">
            <div className="grid gap-1 text-center">
              <p className="text-sm font-bold tracking-wide text-brand-600 uppercase">How it works</p>
              <h2 id="how" className="text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
                Selling in three steps
              </h2>
            </div>
            <ol className="grid gap-4 md:grid-cols-3">
              {steps.map((step, i) => (
                <li key={step.title} className="grid content-start gap-3 rounded-3xl border border-navy-200 bg-white p-6">
                  <span className="grid size-10 place-items-center rounded-2xl bg-brand-50 text-lg font-extrabold text-brand-600">{i + 1}</span>
                  <h3 className="text-lg font-bold text-navy-900">{step.title}</h3>
                  <p className="text-navy-600">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="text-center">
              <SellButton href={links.sell} label="Create my free account" />
            </div>
          </section>

          <section aria-labelledby="ways" className="mx-auto grid max-w-6xl gap-6 px-4 sm:px-6">
            <h2 id="ways" className="text-center text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
              Two ways to sell
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              <article className="grid content-start gap-4 rounded-3xl bg-white p-6 ring-1 ring-navy-200 sm:p-8">
                <ShopIcon name="tag" className="size-9 text-brand-600" />
                <h3 className="text-xl font-extrabold text-navy-900">Sell your own things</h3>
                <p className="text-navy-600">A phone you have upgraded from, a car, furniture, clothes or stock from your shop. Post it, chat with buyers near you and get paid safely.</p>
                <ul className="grid gap-2 text-sm text-navy-700">
                  {["Free listings with photos and video", "Offers and questions in Udozo's chat", "Safe pay or cash when you meet"].map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-mint-500" aria-hidden="true" /> {item}
                    </li>
                  ))}
                </ul>
                <SellButton href={links.sell} />
              </article>
              <article className="grid content-start gap-4 rounded-3xl bg-navy-900 p-6 text-white sm:p-8">
                <Store className="size-9 text-brand-300" aria-hidden="true" />
                <h3 className="text-xl font-extrabold">Run your own store, without stock</h3>
                <p className="text-white/80">On Seller HQ, choose listings suppliers open to resellers, set your own price and sell them on your own branded store. The supplier delivers; you earn the difference.</p>
                <ul className="grid gap-2 text-sm text-white/85">
                  {["No stock to buy or store", "Your own domain and brand, every feature free", "Buyers pay with Safe pay: no chasing payments"].map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-mint-500" aria-hidden="true" /> {item}
                    </li>
                  ))}
                </ul>
                <Link href={links.store} className="inline-flex min-h-13 w-fit items-center gap-2 rounded-2xl bg-white px-6 text-base font-bold text-navy-900 hover:bg-brand-50">
                  Open your store <ArrowRight className="size-5" aria-hidden="true" />
                </Link>
              </article>
            </div>
          </section>

          <section aria-labelledby="why" className="mx-auto grid max-w-6xl gap-8 px-4 sm:px-6">
            <h2 id="why" className="text-center text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
              Why sellers choose Udozo
            </h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {reasons.map(reason => (
                <li key={reason.title} className="grid content-start gap-2 rounded-3xl border border-navy-200 bg-white p-6">
                  <ShopIcon name={reason.icon} className="size-7 text-brand-600" />
                  <h3 className="font-bold text-navy-900">{reason.title}</h3>
                  <p className="text-sm text-navy-600">{reason.body}</p>
                </li>
              ))}
            </ul>
          </section>

          <Categories categories={categories} />

          <section aria-labelledby="questions" className="mx-auto grid w-full max-w-3xl gap-4 px-4 sm:px-6">
            <h2 id="questions" className="text-center text-2xl font-extrabold tracking-tight text-navy-900 sm:text-3xl">
              Questions sellers ask
            </h2>
            <div className="grid gap-3">
              {faqs.map(item => (
                <details key={item.q} className="group rounded-2xl border border-navy-200 bg-white">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 font-semibold text-navy-900 [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span aria-hidden="true" className="text-xl text-brand-600 transition-transform group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="border-t border-navy-100 px-5 py-4 text-navy-700">{item.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="mx-4 rounded-[2rem] bg-gradient-to-br from-brand-500 to-brand-700 px-6 py-12 text-center text-white sm:mx-auto sm:w-full sm:max-w-5xl sm:px-10">
            <h2 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Your first sale starts here</h2>
            <p className="mx-auto mt-3 max-w-xl text-white/90">It takes two minutes to sign up, and listing is free. Your buyers are already on Udozo.</p>
            <div className="mt-6 flex justify-center">
              <SellButton href={links.sell} label="Start selling free" light />
            </div>
          </section>
        </div>
      </main>

      <footer className="border-t border-navy-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 text-sm text-navy-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Udozo</p>
          <nav aria-label="Udozo links" className="flex flex-wrap gap-x-5 gap-y-2">
            <Link href="/" className="hover:underline">
              Browse Udozo
            </Link>
            <Link href="/safe-trade" className="hover:underline">
              Safe Trade Guide
            </Link>
            <Link href="/legal/terms" className="hover:underline">
              Terms
            </Link>
            <Link href="/legal/sellers" className="hover:underline">
              Seller terms
            </Link>
            <Link href="/legal/privacy" className="hover:underline">
              Privacy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
