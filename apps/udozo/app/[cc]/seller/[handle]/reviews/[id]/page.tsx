import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { sellerPath, sellerSlug, type ShopReview, type ShopReviewViewer, type ShopSellerProfile } from "@bitocard/api-client/classifieds";
import { ReviewThread } from "@/components/reviews/review-forms";
import { ReviewCard } from "@/components/reviews/review-view";
import { shopApi } from "@/lib/api";
import { currentCustomer, customerApi } from "@/lib/customer";
import { reviewPath } from "@/lib/reviews";
import { isSellerKey } from "@/lib/seller";
import { noindexFollow } from "@/lib/seo";

type Props = { params: Promise<{ cc: string; handle: string; id: string }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const metadata: Metadata = { title: "A review on Udozo", robots: noindexFollow };

/**
 * One review with its whole conversation (not indexed: the seller's page carries the reviews). Signed in, the reader sees
 * it fresh, with the reply form where they may write (the seller, the reviewer, or a buyer of the same item).
 */
export default async function ReviewPage({ params }: Props) {
  const { cc, handle, id } = await params;
  if (!uuid.test(id) || !isSellerKey(handle.toLowerCase())) notFound();
  const customer = await currentCustomer();
  const [profile, review, viewer] = await Promise.all([
    shopApi<ShopSellerProfile>(`/v1/classifieds/sellers/${handle.toLowerCase()}`),
    customer ? customerApi<ShopReview>("GET", `/v1/classifieds/me/reviews/${id}`) : shopApi<ShopReview>(`/v1/classifieds/reviews/${id}`),
    customer ? customerApi<ShopReviewViewer>("GET", `/v1/classifieds/reviews/${id}/viewer`) : null,
  ]);
  if (!profile.ok || !review.ok) notFound();
  const slug = profile.data.redirect || sellerSlug(profile.data);
  const base = sellerPath(profile.data.country, slug);
  if (review.data.seller.handle !== profile.data.handle) notFound();
  if (handle !== slug || cc.toLowerCase() !== profile.data.country.toLowerCase()) permanentRedirect(reviewPath(base, id));
  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-6">
      <Link href={`${base}#reviews`} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-700 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" /> All reviews of {profile.data.name}
      </Link>
      <h1 className="text-xl font-extrabold">A review of {profile.data.name}</h1>
      <ReviewCard review={{ ...review.data, posts: [] }} full />
      <ReviewThread review={review.data} viewer={viewer?.ok ? viewer.data : null} />
      {!customer ? (
        <p className="text-sm text-navy-600">
          Bought this item from {profile.data.name}?{" "}
          <Link href={`/signin?next=${encodeURIComponent(reviewPath(base, id))}`} className="font-semibold underline">
            Sign in
          </Link>{" "}
          to join the conversation.
        </p>
      ) : null}
    </div>
  );
}
