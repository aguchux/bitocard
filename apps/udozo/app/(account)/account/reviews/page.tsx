import type { Metadata } from "next";
import Link from "next/link";
import type { ShopMyReviews, ShopPurchases, ShopReview, ShopReviewViewer } from "@bitocard/api-client/classifieds";
import { PageTitle } from "@/components/account/nav";
import { Thumb } from "@/components/account/thumb";
import { OwnReviewActions, ReviewForm, ReviewThread } from "@/components/reviews/review-forms";
import { ReviewCard } from "@/components/reviews/review-view";
import { requireSeller } from "@/lib/account";
import { customerApi } from "@/lib/customer";
import { reviewPath, reviewSellerBase } from "@/lib/reviews";

export const metadata: Metadata = { title: "Reviews" };

type Props = { searchParams: Promise<{ tab?: string; review?: string }> };
type Tab = "to_review" | "given" | "about";
const tabs: Array<{ key: Tab; label: string }> = [
  { key: "to_review", label: "To review" },
  { key: "given", label: "Your reviews" },
  { key: "about", label: "About you" },
];
const statusWords = { held: "Waiting for a moderator", removed: "Removed by Udozo", withdrawn: "Withdrawn", published: "Showing" } as const;

/**
 * Reviews in the account: purchases waiting for the buyer's rating, the reviews they wrote (with their status, to change
 * or withdraw), and the reviews about them as a seller, each with its conversation to reply in.
 */
export default async function ReviewsPage({ searchParams }: Props) {
  const query = await searchParams;
  await requireSeller("/account/reviews");
  const tab: Tab = query.tab === "given" || query.tab === "about" ? query.tab : "to_review";
  const [toReview, given, about] = await Promise.all([
    customerApi<ShopPurchases>("GET", "/v1/classifieds/me/purchases?state=to_review&limit=50"),
    tab === "given" ? customerApi<ShopMyReviews>("GET", "/v1/classifieds/me/reviews?role=given") : null,
    tab === "about" ? customerApi<ShopMyReviews>("GET", "/v1/classifieds/me/reviews?role=received") : null,
  ]);
  const purchases = toReview.ok ? toReview.data.data.filter(item => !item.dismissed) : [];
  const chosen = tab === "given" ? given : about;
  const list: ShopMyReviews["data"] = chosen?.ok ? chosen.data.data : [];
  const viewers = new Map<string, ShopReviewViewer>();
  if (tab !== "to_review") {
    const answers = await Promise.all(list.map(review => customerApi<ShopReviewViewer>("GET", `/v1/classifieds/reviews/${review.id}/viewer`)));
    answers.forEach((answer, index) => answer.ok && viewers.set(list[index]!.id, answer.data));
  }
  const counts: Record<Tab, number> = { to_review: toReview.ok ? toReview.data.to_review : 0, given: 0, about: 0 };
  return (
    <div className="grid max-w-3xl gap-5">
      <PageTitle title="Reviews" />
      <nav aria-label="Reviews">
        <ul className="flex flex-wrap gap-2">
          {tabs.map(item => (
            <li key={item.key}>
              <Link
                href={item.key === "to_review" ? "/account/reviews" : `/account/reviews?tab=${item.key}`}
                aria-current={item.key === tab ? "page" : undefined}
                className={`flex h-9 items-center gap-1.5 rounded-full border px-4 text-[13px] font-semibold ${item.key === tab ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900"}`}
              >
                {item.label}
                {counts[item.key] ? <span className={item.key === tab ? "text-brand-300" : "text-brand-700"}>• {counts[item.key]}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "to_review" ? (
        purchases.length ? (
          <ul className="grid gap-4">
            {purchases.map(purchase => (
              <li key={purchase.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
                <span className="flex items-center gap-3">
                  <Thumb url={purchase.listing.cover_url} size="size-14" />
                  <span className="grid min-w-0">
                    <Link href={purchase.listing.path} className="truncate font-bold hover:underline">
                      {purchase.listing.title ?? purchase.product_label}
                    </Link>
                    <span className="text-xs text-slate-500">
                      From {purchase.seller.name} · rate by {new Date(purchase.review_closes_at).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}
                    </span>
                  </span>
                </span>
                <ReviewForm purchaseId={purchase.id} seller={purchase.seller.name} neutral={purchase.neutral_allowed} dismissible />
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">Nothing to rate. When you buy with Safe pay or a buy order, you can rate the seller here.</p>
        )
      ) : list.length ? (
        <ul className="grid gap-4">
          {list.map(review => (
            <li key={review.id} className={`grid gap-2 ${query.review === review.id ? "rounded-3xl ring-2 ring-brand-500" : ""}`}>
              {review.status ? <span className="text-xs font-semibold text-slate-600">{statusWords[review.status]}</span> : null}
              <ReviewCard review={tab === "about" ? { ...review, posts: [] } : (review as ShopReview)} full>
                <Link href={review.listing.path} className="text-xs font-semibold text-slate-600 hover:underline">
                  {review.listing.title ?? "The listing"}
                </Link>
                {review.status === "published" ? (
                  <Link href={reviewPath(reviewSellerBase(review), review.id)} className="text-xs font-semibold text-brand-700 hover:underline">
                    Open its public page
                  </Link>
                ) : null}
              </ReviewCard>
              {tab === "given" ? (
                <OwnReviewActions review={review} seller={review.seller.name} neutral={false} canEdit={Boolean(viewers.get(review.id)?.can_edit)} />
              ) : (
                <ReviewThread review={review} viewer={viewers.get(review.id) ?? null} />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-600">{tab === "given" ? "You have not reviewed anyone yet." : "No reviews about you yet. Buyers can rate you after a sale is completed."}</p>
      )}
    </div>
  );
}
