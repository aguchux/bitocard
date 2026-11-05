import Link from "next/link";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { reviewAspectLabels, reviewRatingLabels, reviewSourceLabels, reviewStanceLabels, type ShopReview, type ShopReviewAspect, type ShopReviewPost, type ShopReviewSummary } from "@bitocard/api-client/classifieds";
import { Avatar } from "@bitocard/ui/avatar";
import { monthText, ratingTone, summaryText } from "@/lib/reviews";

const roleLabels = { seller: "Seller", reviewer: "Reviewer", buyer: "Buyer" } as const;

/** A seller's reviews in a line: the positive share once enough count, and how many of each. */
export function ReviewSummaryBar({ summary }: { summary: ShopReviewSummary }) {
  const text = summaryText(summary);
  const total = summary.positive + summary.neutral + summary.negative;
  return (
    <div className="grid gap-2 rounded-2xl border border-navy-200 bg-white p-4">
      <p className="text-lg font-extrabold">{text ?? "No reviews yet"}</p>
      {total ? (
        <ul className="flex flex-wrap gap-2 text-xs font-semibold">
          <li className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-800">{summary.positive} positive</li>
          {summary.neutral ? <li className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{summary.neutral} neutral</li> : null}
          <li className="rounded-full bg-red-50 px-2.5 py-1 text-red-800">{summary.negative} negative</li>
        </ul>
      ) : null}
      <p className="text-xs text-navy-600">
        From buyers who bought from this seller in the last 12 months, each buyer counted once.{" "}
        <Link href="/legal/terms#reviews" className="font-semibold underline">
          How reviews work
        </Link>
      </p>
    </div>
  );
}

export function RatingBadge({ rating }: { rating: ShopReview["rating"] }) {
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${ratingTone(rating)}`}>{reviewRatingLabels[rating]}</span>;
}

/** One post in a review's conversation. */
export function ReviewPostItem({ post, children }: { post: ShopReviewPost; children?: React.ReactNode }) {
  return (
    <li className={`grid gap-1 rounded-xl px-3 py-2 text-sm ${post.role === "seller" ? "bg-navy-50" : "bg-slate-50"}`}>
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
        <Avatar name={post.name} url={post.avatar_url} className="size-6 text-[10px] font-bold" />
        <strong className="text-navy-900">{post.name}</strong>
        <span className="rounded-full bg-white px-1.5 py-0.5 font-semibold ring-1 ring-slate-200">{roleLabels[post.role]}</span>
        {post.stance ? <span className="font-semibold">{reviewStanceLabels[post.stance]}</span> : null}
        {post.edited ? <span>Edited</span> : null}
      </span>
      {post.removed ? <span className="text-slate-500 italic">Removed by Udozo</span> : <span className="whitespace-pre-wrap">{post.body}</span>}
      {children}
    </li>
  );
}

/**
 * A review: its rating, the parts marked, the words, who wrote it (first name and initial) and when, what was bought
 * and how, then the first posts of its conversation (all with `full`) and a link to read on.
 */
export function ReviewCard({ review, href, full = false, children }: { review: ShopReview; href?: string | null; full?: boolean; children?: React.ReactNode }) {
  const aspects = Object.entries(review.aspects) as Array<[ShopReviewAspect, "up" | "down"]>;
  const more = review.post_count - review.posts.length;
  return (
    <article className="grid gap-2.5 rounded-2xl border border-slate-200 bg-white p-4" id={`review-${review.id}`}>
      <header className="flex flex-wrap items-center gap-2">
        <Avatar name={review.reviewer.name} url={review.reviewer.avatar_url} className="size-9 text-xs font-bold" />
        <span className="grid min-w-0">
          <strong className="truncate text-sm">{review.reviewer.name}</strong>
          <span className="text-xs text-slate-500">
            {monthText(review.month)} · {reviewSourceLabels[review.source]}
          </span>
        </span>
        <span className="ml-auto">
          <RatingBadge rating={review.rating} />
        </span>
      </header>
      <p className="text-xs font-semibold text-slate-600">Bought: {review.product.label}</p>
      {aspects.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {aspects.map(([key, value]) => (
            <li key={key} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${value === "up" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
              {value === "up" ? <ThumbsUp className="size-3" aria-hidden="true" /> : <ThumbsDown className="size-3" aria-hidden="true" />}
              {reviewAspectLabels[key]}
              <span className="sr-only">{value === "up" ? ": good" : ": not good"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {review.body ? <p className="text-sm whitespace-pre-wrap">{review.body}</p> : null}
      {review.edited ? <p className="text-xs text-slate-500">{review.edited_after_reply ? "Edited after the seller replied" : "Edited"}</p> : null}
      {review.posts.length ? (
        <ol className="grid gap-1.5 border-l-2 border-slate-200 pl-3">
          {review.posts.map(post => (
            <ReviewPostItem key={post.id} post={post} />
          ))}
        </ol>
      ) : null}
      {href && !full ? (
        <Link href={href} className="text-sm font-semibold text-brand-700 hover:underline">
          {more > 0 ? `Read the conversation (${more} more)` : review.post_count ? "Open the conversation" : "Open the review"}
        </Link>
      ) : null}
      {children}
    </article>
  );
}
