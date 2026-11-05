import Link from "next/link";
import { Clock, MessageCircleReply, Sparkles, ThumbsUp } from "lucide-react";
import type { ShopPublicScores } from "@bitocard/api-client/classifieds";

const bandTone: Record<string, string> = { excellent: "bg-mint-50 text-mint-700", very_good: "bg-mint-50 text-mint-700", good: "bg-navy-50 text-navy-800" };

/**
 * Anjio's view on a seller's page: how fast they reply and how often they answer, their band at Good or better, their
 * strong points, and Anjio's short summary with who wrote it. Words only: never a number, and never in metadata.
 */
export function AnjioView({ scores, name }: { scores: ShopPublicScores; name: string }) {
  if (scores.new_seller)
    return (
      <section aria-labelledby="anjio-view" className="grid gap-2 rounded-2xl border border-navy-200 bg-white p-4">
        <h2 id="anjio-view" className="flex items-center gap-2 text-base font-bold">
          <Sparkles className="size-4 text-brand-700" aria-hidden="true" /> Anjio&apos;s view
        </h2>
        <p className="text-sm text-navy-700">New seller: not enough to rate yet.</p>
        <HowItWorks href={scores.how_it_works} />
      </section>
    );
  return (
    <section aria-labelledby="anjio-view" className="grid gap-3 rounded-2xl border border-navy-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="anjio-view" className="flex items-center gap-2 text-base font-bold">
          <Sparkles className="size-4 text-brand-700" aria-hidden="true" /> Anjio&apos;s view of {name}
        </h2>
        {scores.band && scores.band_label ? <span className={`rounded-full px-3 py-1 text-xs font-bold ${bandTone[scores.band] ?? "bg-navy-50 text-navy-800"}`}>{scores.band_label} seller</span> : null}
      </div>
      <ul className="grid gap-2 text-sm">
        {scores.response ? (
          <li className="flex items-center gap-2">
            <Clock className="size-4 shrink-0 text-navy-600" aria-hidden="true" /> {scores.response}
          </li>
        ) : null}
        {scores.attention ? (
          <li className="flex items-center gap-2">
            <MessageCircleReply className="size-4 shrink-0 text-navy-600" aria-hidden="true" /> {scores.attention}
          </li>
        ) : null}
        {scores.highlights.map(item => (
          <li key={item.key} className="flex items-center gap-2">
            <ThumbsUp className="size-4 shrink-0 text-mint-700" aria-hidden="true" /> {item.words}
          </li>
        ))}
      </ul>
      {scores.summary ? (
        <figure className="grid gap-1 rounded-xl bg-navy-50 p-3">
          <blockquote className="text-sm text-navy-900">{scores.summary.text}</blockquote>
          <figcaption className="text-xs text-navy-600">{scores.summary.credit}</figcaption>
        </figure>
      ) : null}
      <HowItWorks href={scores.how_it_works} />
    </section>
  );
}

function HowItWorks({ href }: { href: string }) {
  return (
    <Link href={href} className="w-fit text-xs font-semibold text-navy-700 underline-offset-2 hover:underline">
      How Anjio rates sellers
    </Link>
  );
}
