import type { ShopPurchases, ShopReviewViewer } from "@bitocard/api-client/classifieds";
import { customerApi } from "@/lib/customer";
import { OwnReviewActions, ReviewForm } from "./review-forms";
import { ReviewCard } from "./review-view";

const statusWords = { held: "Waiting for a moderator before it shows.", removed: "Udozo removed this review.", withdrawn: "You withdrew this review.", published: null } as const;

/**
 * The review of a purchase on its order page (a UdozoPay order or a buy order): the form while it can be written, else the
 * buyer's review with what they can still do. Nothing while there is no purchase (not completed, or reviews are off).
 */
export async function PurchaseReview({ orderId, buyOrderId }: { orderId?: string; buyOrderId?: string }) {
  const query = orderId ? `order_id=${orderId}` : `buy_order_id=${buyOrderId}`;
  const result = await customerApi<ShopPurchases>("GET", `/v1/classifieds/me/purchases?${query}&limit=1`);
  const purchase = result.ok ? result.data.data[0] : null;
  if (!purchase) return null;
  const review = purchase.review;
  const viewer = review ? await customerApi<ShopReviewViewer>("GET", `/v1/classifieds/reviews/${review.id}/viewer`) : null;
  return (
    <section aria-labelledby="your-review" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <h2 id="your-review" className="text-sm font-bold">
        {review ? "Your review" : `Rate ${purchase.seller.name}`}
      </h2>
      {review ? (
        <>
          {review.status && statusWords[review.status] ? <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{statusWords[review.status]}</p> : null}
          <ReviewCard review={review} full />
          <OwnReviewActions review={review} seller={purchase.seller.name} neutral={purchase.neutral_allowed} canEdit={Boolean(viewer?.ok && viewer.data.can_edit)} />
        </>
      ) : purchase.can_review ? (
        <ReviewForm purchaseId={purchase.id} seller={purchase.seller.name} neutral={purchase.neutral_allowed} />
      ) : (
        <p className="text-sm text-slate-600">Reviews of this purchase have closed.</p>
      )}
    </section>
  );
}
