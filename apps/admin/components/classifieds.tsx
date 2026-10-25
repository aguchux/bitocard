"use client";

import { useEffect, useState } from "react";
import { Badge, FilterSelect, formatMoney, type Tone } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import {
  chatFile,
  type ClassifiedListing,
  type ClassifiedListingStatus,
  type ClassifiedOrderStatus,
  type ClassifiedPayoutReview,
  type ClassifiedReportReason,
  type ClassifiedReviewFlag,
  useCountriesQuery,
} from "@bitocard/api-client/admin";

/** BitoCard Shop's admin screens share these labels, so every page says the same thing for the same state. */

export const listingStatusLabels: Record<ClassifiedListingStatus, string> = {
  draft: "Draft",
  pending_review: "Waiting for review",
  active: "Live",
  sold: "Sold",
  expired: "Expired",
  rejected: "Sent back",
  removed: "Removed",
  deleted: "Deleted by the seller",
};

export const listingTones: Record<ClassifiedListingStatus, Tone> = {
  draft: "grey",
  pending_review: "amber",
  active: "green",
  sold: "blue",
  expired: "grey",
  rejected: "amber",
  removed: "red",
  deleted: "grey",
};

export const flagLabels: Record<ClassifiedReviewFlag, string> = {
  first_listings: "New seller",
  prohibited_words: "Doubtful words",
  price_low: "Price far below usual",
  photo_reused: "Another seller's photo",
  posting_fast: "Posting fast",
  reported: "Reported",
};

export const reportReasonLabels: Record<ClassifiedReportReason, string> = {
  scam: "Scam or fraud",
  prohibited: "Prohibited item",
  wrong_category: "Wrong category",
  duplicate: "Duplicate",
  sold: "Already sold",
  offensive: "Offensive",
  other: "Other",
};

export const orderStatusLabels: Record<ClassifiedOrderStatus, string> = {
  requested: "Asked, waiting for the seller",
  declined: "Declined",
  lapsed: "Lapsed",
  awaiting_payment: "Accepted, waiting for payment",
  cancelled: "Cancelled",
  paid: "Paid, in escrow",
  sent: "Sent",
  disputed: "Disputed",
  released: "Released to the seller",
  refunded: "Refunded",
  partly_refunded: "Part refunded",
};

export const orderTones: Record<ClassifiedOrderStatus, Tone> = {
  requested: "amber",
  declined: "grey",
  lapsed: "grey",
  awaiting_payment: "amber",
  cancelled: "grey",
  paid: "blue",
  sent: "blue",
  disputed: "red",
  released: "green",
  refunded: "grey",
  partly_refunded: "grey",
};

export const disputeReasonLabels: Record<string, string> = { not_received: "Not received", not_as_described: "Not as described", damaged: "Damaged", other: "Other" };

export const payoutReviewLabels: Record<ClassifiedPayoutReview, string> = { pending: "Payout held for review", approved: "Payout approved", rejected: "Payout kept held" };
export const payoutReviewTones: Record<ClassifiedPayoutReview, Tone> = { pending: "amber", approved: "green", rejected: "red" };

export function ListingStatus({ status }: { status: ClassifiedListingStatus }) {
  return <Badge tone={listingTones[status]}>{listingStatusLabels[status]}</Badge>;
}

export function OrderStatus({ status }: { status: ClassifiedOrderStatus }) {
  return <Badge tone={orderTones[status]}>{orderStatusLabels[status]}</Badge>;
}

/** The listed price, or how the seller asks for offers. */
export function listingPrice(price: ClassifiedListing["price"]) {
  if (price.kind === "on_request" || price.amount === null) return "Price on request";
  return `${formatMoney(price.amount, price.currency)}${price.kind === "negotiable" ? " (negotiable)" : ""}`;
}

/** The markets an admin can pick, BitoCard Shop's first (Nigeria). */
export function useMarketOptions() {
  const countries = useCountriesQuery();
  return (countries.data?.data ?? []).map(country => ({ value: country.code, label: country.name }));
}

export function MarketFilter({ id, value, onChange, all = true }: { id: string; value: string; onChange: (value: string) => void; all?: boolean }) {
  const markets = useMarketOptions();
  const options = markets.length ? markets : [{ value: value || "NG", label: value || "NG" }];
  return <FilterSelect id={id} label="Market" value={value} onChange={onChange} options={all ? [{ value: "", label: "All markets" }, ...options] : options} />;
}

/** A listing's cover, title, number and place: links to its admin page. */
export function ListingCell({ listing }: { listing: { id: string; ref: number; title: string | null; photos?: Array<{ url: string }>; cover_url?: string | null } }) {
  const cover = listing.cover_url ?? listing.photos?.[0]?.url ?? null;
  return (
    <AppLink href={`/classifieds/listings/${listing.id}`} className="flex min-w-0 items-center gap-3 hover:underline">
      {cover ? <img src={cover} alt="" className="size-11 shrink-0 rounded-lg border border-line bg-white object-cover" loading="lazy" /> : <span className="size-11 shrink-0 rounded-lg border border-line bg-canvas" aria-hidden />}
      <span className="min-w-0">
        <span className="block truncate font-semibold text-ink">{listing.title ?? "Untitled draft"}</span>
        <span className="block text-xs text-muted">#{listing.ref}</span>
      </span>
    </AppLink>
  );
}

/** A customer as the seller or buyer: their BitoCard Shop page, with the email beneath. */
export function PersonCell({ person }: { person: { id: string; name: string; email: string } }) {
  return (
    <AppLink href={`/classifieds/sellers/${person.id}`} className="block min-w-0 hover:underline">
      <span className="block truncate font-medium text-ink">{person.name}</span>
      <span className="block truncate text-xs text-muted">{person.email}</span>
    </AppLink>
  );
}

/**
 * A photo from the private bucket (a reported chat's, or a dispute's), read through the API with the admin's session:
 * an `<img>` cannot send it. Each open is audited by the API.
 */
export function PrivatePhoto({ path, alt }: { path: string; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let live = true;
    chatFile(path)
      .then(blob => {
        if (!live) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  if (failed) return <span className="block rounded-lg border border-line p-3 text-xs text-muted">This photo could not be opened.</span>;
  if (!url) return <span className="block h-40 w-56 animate-pulse rounded-lg bg-canvas" aria-label="Loading photo" />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      <img src={url} alt={alt} className="max-h-72 max-w-full rounded-lg border border-line object-contain" />
    </a>
  );
}
