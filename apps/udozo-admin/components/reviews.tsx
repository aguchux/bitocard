"use client";

import { Badge, type Tone } from "@bitocard/admin-ui";
import type { AdminReview, AdminReviewStatus } from "@bitocard/api-client/admin";

/** Reviews in plain words, the same on every screen. */
export const reviewStatusLabels: Record<AdminReviewStatus, string> = { published: "Showing", held: "Held for a moderator", removed: "Removed", withdrawn: "Withdrawn by the reviewer" };
const statusTones: Record<AdminReviewStatus, Tone> = { published: "green", held: "amber", removed: "red", withdrawn: "grey" };
export const ratingLabels: Record<AdminReview["rating"], string> = { positive: "Positive", neutral: "Neutral", negative: "Negative" };
const ratingTones: Record<AdminReview["rating"], Tone> = { positive: "green", neutral: "grey", negative: "red" };
export const heldReasonLabels: Record<string, string> = { words: "It uses a word our rules flag", new_account: "The reviewer's account is new", quick_sale: "Marked sold within the hour of accepting" };
export const aspectLabels: Record<string, string> = { described: "As described", communication: "Communication", handover: "Hand-over" };
export const roleLabels: Record<string, string> = { seller: "Seller", reviewer: "Reviewer", buyer: "Buyer" };
export const stanceLabels: Record<string, string> = { agree: "agrees", disagree: "disagrees", context: "adds context" };
export const sourceLabels: Record<string, string> = { safe_pay: "Safe pay purchase", buy_order: "Buy order" };
export const reportReasonLabels: Record<string, string> = {
  fake: "Looks fake",
  not_a_buyer: "Not a buyer",
  offensive: "Offensive or abusive",
  personal_info: "Personal details",
  contact_or_links: "Contact details or links",
  threat_or_extortion: "Threat or extortion",
  off_topic: "Off topic",
  other: "Something else",
};

export function ReviewStatusBadge({ status }: { status: AdminReviewStatus }) {
  return <Badge tone={statusTones[status]}>{reviewStatusLabels[status] ?? status}</Badge>;
}

export function RatingBadge({ rating }: { rating: AdminReview["rating"] }) {
  return <Badge tone={ratingTones[rating]}>{ratingLabels[rating] ?? rating}</Badge>;
}
