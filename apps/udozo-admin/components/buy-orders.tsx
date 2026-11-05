"use client";

import { Badge, type Tone } from "@bitocard/admin-ui";
import type { BuyOrderParty, BuyOrderStatus } from "@bitocard/api-client/admin";

/** Buy orders' states in plain words, the same on every screen. */
export const buyOrderStatusLabels: Record<BuyOrderStatus, string> = {
  requested: "Asked, waiting for the seller",
  countered: "Seller countered",
  accepted: "Accepted, to meet",
  completed: "Bought",
  declined: "Declined",
  cancelled: "Cancelled",
  lapsed: "Lapsed: no answer",
  expired: "Expired: did not meet",
  no_show: "Did not show up",
  voided: "Buyer said they did not buy it",
};

export const buyOrderTones: Record<BuyOrderStatus, Tone> = {
  requested: "amber",
  countered: "amber",
  accepted: "blue",
  completed: "green",
  declined: "grey",
  cancelled: "grey",
  lapsed: "grey",
  expired: "grey",
  no_show: "red",
  voided: "red",
};

export const buyOrderPartyLabels: Record<BuyOrderParty, string> = { buyer: "Buyer", seller: "Seller", udozo: "Udozo" };

export const completedByLabels: Record<"seller" | "buyer" | "auto", string> = {
  seller: "The seller marked it sold",
  buyer: "The buyer said they bought it",
  auto: "Completed by itself, 3 days after the buyer said they bought it",
};

export function BuyOrderStatusBadge({ status }: { status: BuyOrderStatus }) {
  return <Badge tone={buyOrderTones[status]}>{buyOrderStatusLabels[status] ?? status}</Badge>;
}
