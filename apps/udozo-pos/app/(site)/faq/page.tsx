import type { Metadata } from "next";
import Link from "next/link";
import { udozoUrl } from "@/lib/site";

export const metadata: Metadata = {
  title: "Questions",
  description: "Answers about Udozo POS: the Udozo account, shop-only items, equipment, paying for a plan and cancelling.",
  alternates: { canonical: "/faq" },
};

const questions = [
  { q: "Do I need a udozo.com account?", a: "Yes: the shop owner signs up with their Udozo account, which is free. Your staff do not need one; they get a PIN." },
  { q: "Can I sell items that are not shown online?", a: "Yes. Add them on udozo.com, tick Sell at POS and set them to shop only." },
  { q: "What equipment do I need?", a: "Any phone, tablet or computer with a browser. Receipt printers and barcode scanners are optional." },
  { q: "How do I pay for a plan?", a: "From your Udozo wallet, which you top up on udozo.com by card, bank transfer or mobile money. Free needs no payment." },
  { q: "Can I cancel?", a: "At any time, from Billing. A paid plan runs to the end of its month, then your shop moves to Free, and your udozo.com listings keep working as before." },
];

/** Common questions, on a page of their own. */
export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="text-center font-display text-4xl font-bold text-pos-ink">Questions</h1>
      <p className="mx-auto mt-3 max-w-xl text-center text-lg text-pos-ink-2">What shop owners ask before they start.</p>
      <div className="mt-10 grid gap-3">
        {questions.map(item => (
          <details key={item.q} className="rounded-2xl border border-pos-line bg-white p-5">
            <summary className="font-semibold text-pos-ink">{item.q}</summary>
            <p className="mt-2 text-pos-ink-2">{item.a}</p>
          </details>
        ))}
      </div>
      <p className="mt-10 text-center text-pos-ink-2">
        Something else? <a href={udozoUrl("/help/contact")}>Contact Udozo</a>, or <Link href="/signup">start free</Link>.
      </p>
    </div>
  );
}
