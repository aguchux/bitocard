import type { Metadata } from "next";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { ShopTopCategory } from "@bitocard/api-client/classifieds";
import { ShopIcon } from "@/components/icon";
import { markets } from "@/lib/api";
import { categoriesOf } from "@/lib/reference";

export const metadata: Metadata = {
  title: "Safe Trade Guide",
  description: "How to buy and sell safely on Udozo: checks before and at a meeting, checks for each category, red flags, and how Safe pay holds the money until you have the item.",
  alternates: { canonical: "/safe-trade" },
};

const groups = [
  { title: "Before you meet", items: ["Keep the chat on Udozo", "Check the seller's badges", "The price is close to similar listings", "Agree the place, time and how you will pay", "Tell someone where you are going"] },
  { title: "At the meeting", items: ["A busy public place, in daylight", "Inspect and test it with the checks below", "Check papers and serial numbers", "Pay only when you are happy; confirm a transfer in your own banking app"] },
  { title: "If you are selling", items: ["Hand over only when the money shows in your own account", "Never trust an SMS alert or a screenshot", "Refuse overpayments; check cash notes"] },
];

const redFlags =
  'A price far below others, pressure to decide now, a deposit or "delivery fee" first, payment screenshots instead of money, overpaying and asking for change, moving the chat to another app, or asking for any code.';

/** Every category's checks across the open countries, once each (subcategories inherit their top category's). */
function checklists(lists: ShopTopCategory[][]) {
  const seen = new Map<string, { name: string; icon: string; items: string[] }>();
  for (const categories of lists) for (const category of categories) if (category.safety_checklist.length && !seen.has(category.slug)) seen.set(category.slug, { name: category.name, icon: category.icon, items: category.safety_checklist });
  return [...seen.entries()];
}

/**
 * The Safe Trade Guide: the checks for every trade a buyer pays for themselves, each category's own checks, the red
 * flags, and how Safe pay protects them instead.
 */
export default async function SafeTradePage() {
  const all = await markets();
  const categories = checklists(await Promise.all(all.data.map(market => categoriesOf(market.country))));
  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 pt-5">
      <header className="grid gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Safe Trade Guide</h1>
        <p className="text-navy-600">Tick these off for every trade you pay for yourself. With Safe pay, we hold the money for you.</p>
      </header>
      <section id="safe-pay" aria-labelledby="safe-pay-heading" className="grid gap-2 rounded-2xl border border-mint-500/30 bg-mint-50 p-4 text-navy-800">
        <h2 id="safe-pay-heading" className="flex items-center gap-2 font-bold text-mint-700">
          <ShieldCheck className="size-5" aria-hidden="true" /> Safe pay
        </h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>You ask to buy; the seller accepts.</li>
          <li>You pay from your Udozo wallet. Udozo holds the money.</li>
          <li>You check the item: at a meet-up you give the seller your release code, for a delivery you confirm it arrived.</li>
          <li>Not as described, or it never came? Open a dispute and Udozo decides. If the seller cancels or does not hand it over in time, you are refunded in full, fee included.</li>
        </ol>
        <p className="text-xs text-navy-600">Udozo is not the seller and does not inspect goods. Safe pay is your choice on each purchase, for a small fee shown before you pay.</p>
      </section>
      {groups.map(group => (
        <section key={group.title} aria-labelledby={group.title}>
          <h2 id={group.title} className="mb-2 text-base font-bold">
            {group.title}
          </h2>
          <ul className="grid gap-2">
            {group.items.map(item => (
              <li key={item} className="flex items-start gap-2.5 rounded-xl border border-navy-200 bg-white p-3 text-sm">
                <span className="mt-0.5 size-4 shrink-0 rounded border-2 border-navy-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {categories.length ? (
        <section aria-labelledby="category-checks" className="grid gap-3">
          <h2 id="category-checks" className="text-base font-bold">
            Checks for each category
          </h2>
          {categories.map(([slug, category]) => (
            <details key={slug} id={slug} className="rounded-2xl border border-navy-200 bg-white">
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-3.5 font-semibold [&::-webkit-details-marker]:hidden">
                <ShopIcon name={category.icon} className="size-5 text-brand-700" /> {category.name}
              </summary>
              <ul className="list-disc space-y-1 border-t border-navy-100 px-8 py-3 text-sm">
                {category.items.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          ))}
        </section>
      ) : null}
      <section aria-labelledby="red-flags" className="grid gap-2 rounded-2xl border border-brand-200 bg-brand-50 p-4">
        <h2 id="red-flags" className="flex items-center gap-2 font-bold text-brand-700">
          <AlertTriangle className="size-5" aria-hidden="true" /> Red flags
        </h2>
        <p className="text-sm text-navy-800">{redFlags}</p>
        <p className="text-sm text-navy-800">Udozo never asks for your codes, PINs or passwords, in a chat or anywhere else.</p>
      </section>
    </div>
  );
}
