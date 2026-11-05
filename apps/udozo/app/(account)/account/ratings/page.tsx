import type { Metadata } from "next";
import { Lock, Star } from "lucide-react";
import type { ShopInteractionSummary, ShopMyScores } from "@bitocard/api-client/classifieds";
import { PageTitle } from "@/components/account/nav";
import { ReviewsNav } from "@/components/reviews/reviews-nav";
import { ReportSummary } from "@/components/scores/report-summary";
import { bandText, myScoreLines } from "@/lib/scores";
import Link from "next/link";
import { requireSeller } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { asOfText, scoreWord, summaryLines, summaryWaiting } from "@/lib/ratings";

export const metadata: Metadata = { title: "Private ratings" };

/**
 * How buyers rate the way the seller deals with them before buying (after chats, calls, call backs and contact
 * requests): never public, and never who said what. The summary shows from five ratings and counts up to last midnight,
 * so no single rating can be told apart; there is no breakdown by listing.
 */
export default async function RatingsPage() {
  await requireSeller("/account/ratings");
  const [answer, mine] = await Promise.all([customerApi<ShopInteractionSummary>("GET", "/v1/classifieds/me/ratings"), customerApi<ShopMyScores>("GET", "/v1/classifieds/me/scores")]);
  const scores = mine.ok ? mine.data : null;
  const summary = answer.ok ? answer.data : null;
  const lines = summary ? summaryLines(summary) : null;
  const waiting = summary ? summaryWaiting(summary) : "Your ratings could not be loaded just now. Try again shortly.";
  return (
    <div className="grid max-w-3xl gap-5">
      <PageTitle title="Reviews" />
      <ReviewsNav current="ratings" />
      {scores ? <MyScores scores={scores} /> : null}
      <p className="flex gap-2 rounded-2xl bg-navy-50 p-4 text-sm text-navy-800">
        <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          After a chat, call, call back or contact request, buyers can rate how you dealt with them. These ratings are private: nobody else sees them, and you never see who said what. Udozo uses them to help sellers and keep buyers safe.
        </span>
      </p>
      {lines && summary ? (
        <section aria-label="Your summary" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-bold">From {summary.count} buyers</h2>
            <span className="text-xs text-slate-500">{asOfText(summary.as_of)}</span>
          </div>
          <dl className="grid gap-3 sm:grid-cols-3">
            {lines.scores.map(line => (
              <div key={line.key} className="grid gap-1 rounded-xl bg-slate-50 p-3">
                <dt className="text-xs font-semibold text-slate-600">{line.label}</dt>
                <dd className="flex items-center gap-1.5 text-lg font-bold">
                  <Star className="size-5 fill-amber-400 text-amber-500" aria-hidden="true" />
                  {line.value === null ? "—" : line.value.toFixed(1)}
                  <span className="text-sm font-normal text-slate-600">{line.value === null ? "" : scoreWord(line.value)}</span>
                </dd>
              </div>
            ))}
          </dl>
          {lines.tags.length ? (
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">What buyers said</h3>
              <ul className="flex flex-wrap gap-2">
                {lines.tags.map(tag => (
                  <li key={tag.tag} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm">
                    {tag.label} <span className="text-slate-500">· {tag.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">{waiting}</p>
      )}
    </div>
  );
}

/** Anjio's scores for the seller: every number with what it is based on, tips, and the summary to report. */
function MyScores({ scores }: { scores: ShopMyScores }) {
  return (
    <section aria-labelledby="my-scores" className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="my-scores" className="text-lg font-bold">
          Anjio&apos;s scores: {bandText(scores)}
        </h2>
        <span className="text-xs text-slate-500">{scores.public ? "Buyers see these in words on your page." : "Not shown to buyers yet."}</span>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {myScoreLines(scores).map(line => (
          <div key={line.key} className="grid gap-0.5 rounded-xl bg-slate-50 p-3">
            <dt className="text-xs font-semibold text-slate-600">{line.label}</dt>
            <dd className="font-bold">{line.text}</dd>
            {line.note ? <dd className="text-xs text-slate-500">{line.note}</dd> : null}
          </div>
        ))}
      </dl>
      {scores.tips.length ? (
        <div className="grid gap-1.5">
          <h3 className="text-sm font-semibold">What would help</h3>
          <ul className="grid list-disc gap-1 pl-5 text-sm text-slate-700">
            {scores.tips.map(tip => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {scores.summary ? (
        <figure className="grid gap-1.5 rounded-xl bg-navy-50 p-3">
          <blockquote className="text-sm">{scores.summary.text}</blockquote>
          <figcaption className="text-xs text-navy-600">{scores.summary.credit}</figcaption>
          <ReportSummary reported={scores.summary_reported} />
        </figure>
      ) : null}
      <Link href={scores.how_it_works} className="w-fit text-xs font-semibold text-navy-700 hover:underline">
        How Anjio rates sellers
      </Link>
    </section>
  );
}
