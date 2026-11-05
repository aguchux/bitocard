import type { Metadata } from "next";
import { Lock, Star } from "lucide-react";
import type { ShopInteractionSummary } from "@bitocard/api-client/classifieds";
import { PageTitle } from "@/components/account/nav";
import { ReviewsNav } from "@/components/reviews/reviews-nav";
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
  const answer = await customerApi<ShopInteractionSummary>("GET", "/v1/classifieds/me/ratings");
  const summary = answer.ok ? answer.data : null;
  const lines = summary ? summaryLines(summary) : null;
  const waiting = summary ? summaryWaiting(summary) : "Your ratings could not be loaded just now. Try again shortly.";
  return (
    <div className="grid max-w-3xl gap-5">
      <PageTitle title="Reviews" />
      <ReviewsNav current="ratings" />
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
