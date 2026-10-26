import type { ShopFeature, ShopListingStatus, ShopMyListing, ShopOrder } from "@bitocard/api-client/classifieds";

/**
 * The Shop tab's own rules (docs/BITOCARD_CLASSIFIEDS_PLAN.md, The Shop tab), kept apart from React so they are
 * tested: amounts typed in naira, the description's toolbar, which actions a listing or an order offers, and feature
 * values in the type the API stores.
 */

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** An amount typed in the currency's main unit ("520,000" or "1500.50") in minor units, or null when it is not one. */
export function toMinor(text: string) {
  const clean = text.replace(/[,\s]/g, "");
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(clean)) return null;
  const minor = Math.round(Number(clean) * 100);
  return minor > 0 ? minor : null;
}

/** Minor units as the price field shows them ("520,000", "1,500.50"); empty for none. */
export function fromMinor(minor: number | null) {
  if (minor === null) return "";
  const major = minor / 100;
  return major.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(major) ? 0 : 2, maximumFractionDigits: 2 });
}

/** The listing statuses the Shop tab's My listings shows apart, in order (`?status=`). */
/**
 * What a supplier's resale terms mean at their price (minor units), rounded as the API rounds: what they receive from a
 * reseller's sale before BitoCard's fees (the price less the reseller's discount), and the most a reseller may sell at.
 */
export function resaleSums(priceMinor: number | null, discountBps: number, markupMaxBps: number) {
  if (priceMinor === null || priceMinor <= 0) return null;
  return { net: priceMinor - Math.floor((priceMinor * discountBps) / 10000), top: priceMinor + Math.floor((priceMinor * markupMaxBps) / 10000) };
}

/** My listings' tags for where a listing is sold and what is left: "Resellers", "Resellers only", paused, "3 left". */
export function listingChannelTags(listing: Pick<ShopMyListing, "on_shop" | "resale" | "stock" | "status">) {
  const tags: string[] = [];
  if (listing.resale.enabled) tags.push(listing.resale.paused ? "Resellers paused" : listing.on_shop ? "Resellers" : "Resellers only");
  if (listing.stock > 1 && !["sold", "removed"].includes(listing.status)) tags.push(`${listing.stock.toLocaleString("en-GB")} left`);
  return tags;
}

/** A rate in basis points as people read it ("12.5%"). */
export const bpsText = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

export const listingFilters: Array<{ status: ShopListingStatus | null; label: string }> = [
  { status: null, label: "All" },
  { status: "active", label: "Active" },
  { status: "pending_review", label: "In review" },
  { status: "draft", label: "Drafts" },
  { status: "sold", label: "Sold" },
  { status: "expired", label: "Expired" },
];

export type ListingAction = "edit" | "submit" | "sold" | "renew" | "delete" | "view";

/** What a seller can do with a listing in its state (the API checks again). */
export function listingActions(listing: Pick<ShopMyListing, "status" | "url">): ListingAction[] {
  switch (listing.status) {
    case "draft":
      return ["edit", "delete"];
    case "rejected":
      return ["edit", "delete"];
    case "pending_review":
      return ["edit", "delete"];
    case "active":
      return ["edit", "sold", ...(listing.url ? (["view"] as const) : []), "delete"];
    case "expired":
      return ["renew", "delete"];
    case "sold":
      return [...(listing.url ? (["view"] as const) : []), "delete"];
    default:
      return [];
  }
}

/** Status pill colours, as on the design canvas. */
export const listingTones: Record<ShopListingStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending_review: "bg-amber-50 text-amber-800",
  active: "bg-emerald-50 text-emerald-800",
  sold: "bg-navy-900 text-white",
  expired: "bg-slate-100 text-navy-900",
  rejected: "bg-brand-50 text-brand-700",
  removed: "bg-slate-100 text-slate-500",
};

const day = 86_400_000;

/** The listing card's line under its price: what it has done, or where it stands. */
export function listingMeta(listing: Pick<ShopMyListing, "status" | "views" | "leads" | "expires_at" | "updated_at" | "photos">, now = Date.now()) {
  if (listing.status === "active") {
    const left = listing.expires_at ? Math.max(0, Math.ceil((Date.parse(listing.expires_at) - now) / day)) : null;
    return [`${listing.views} ${listing.views === 1 ? "view" : "views"}`, `${listing.leads} ${listing.leads === 1 ? "lead" : "leads"}`, left === null ? null : left === 0 ? "expires today" : `expires in ${left} ${left === 1 ? "day" : "days"}`].filter(Boolean).join(" · ");
  }
  if (listing.status === "draft") return `${listing.photos.length} ${listing.photos.length === 1 ? "photo" : "photos"} · not posted yet`;
  if (listing.status === "pending_review") return "Being checked: usually within a few hours";
  if (listing.status === "expired") return "Expired: renew it to show it again";
  if (listing.status === "rejected") return "Sent back: see why, change it and post again";
  return "";
}

/**
 * The API's address for a private photo (a chat's or a dispute's, `/v1/classifieds/…/photos/<message>`) as this site's
 * own, which reads it with the customer's session; null for anything else.
 */
export function localPhotoUrl(url: string | null | undefined) {
  if (!url) return null;
  const chat = /^\/v1\/classifieds\/conversations\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/.exec(url);
  if (chat) return `/api/shop/chats/${chat[1]}/photos/${chat[2]}`;
  const dispute = /^\/v1\/classifieds\/orders\/([0-9a-f-]{36})\/dispute\/photos\/([0-9a-f-]{36})$/.exec(url);
  if (dispute) return `/api/shop/orders/${dispute[1]}/dispute/photos/${dispute[2]}`;
  return null;
}

// ---- The description's toolbar (limited Markdown: **bold**, *italic*, "- " and "1. " lists) ----

export type Edit = { text: string; start: number; end: number };

/** Wraps the selection in `mark` (`**` bold, `*` italic), or the word "text" when nothing is selected. */
export function wrapSelection(text: string, start: number, end: number, mark: "**" | "*"): Edit {
  const chosen = text.slice(start, end) || "text";
  const next = `${text.slice(0, start)}${mark}${chosen}${mark}${text.slice(end)}`;
  return { text: next, start: start + mark.length, end: start + mark.length + chosen.length };
}

/** Starts every line the selection touches as a bullet (`- `) or a numbered item (`1. `, `2. `…), or takes it off. */
export function toggleList(text: string, start: number, end: number, kind: "ul" | "ol"): Edit {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const to = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(from, to).split("\n");
  const marked = kind === "ul" ? /^[-*•]\s+/ : /^\d{1,3}[.)]\s+/;
  const all = lines.every(line => marked.test(line));
  const changed = lines.map((line, index) => (all ? line.replace(marked, "") : `${kind === "ul" ? "- " : `${index + 1}. `}${line.replace(/^[-*•]\s+|^\d{1,3}[.)]\s+/, "")}`)).join("\n");
  return { text: `${text.slice(0, from)}${changed}${text.slice(to)}`, start: from, end: from + changed.length };
}

// ---- Features ----

/** A typed feature value in the type the API stores: a number, true or false, a choice or text; null clears it. */
export function featureValue(feature: Pick<ShopFeature, "data_type" | "choices">, raw: string | boolean): string | number | boolean | null {
  if (feature.data_type === "boolean") return raw === true || raw === "true";
  const text = String(raw).trim();
  if (!text) return null;
  if (feature.data_type === "number") {
    const number = Number(text.replace(/,/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  if (feature.data_type === "choice") return feature.choices.includes(text) ? text : null;
  return text.slice(0, 120);
}

// ---- Safe pay orders ----

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The order list's line under its status: what the reader does next, or what happened. */
export function orderNext(order: Pick<ShopOrder, "role" | "status" | "fulfilment" | "deadlines" | "with">) {
  const buyer = order.role === "buyer";
  switch (order.status) {
    case "requested":
      return buyer ? `Waiting for ${order.with.name} to accept, by ${when(order.deadlines.accept_by)}.` : `Accept or decline by ${when(order.deadlines.accept_by)}, or it lapses.`;
    case "awaiting_payment":
      return buyer ? `Accepted. Pay from your wallet${order.deadlines.pay_by ? ` by ${when(order.deadlines.pay_by)}` : ""}.` : `Waiting for ${order.with.name} to pay.`;
    case "paid":
      if (order.fulfilment === "meet_up") return buyer ? `Meet ${order.with.name}, check it, then give your release code.` : `Meet ${order.with.name} and enter their release code.`;
      return buyer ? `Paid. ${order.with.name} sends it${order.deadlines.handover_by ? ` by ${when(order.deadlines.handover_by)}` : ""}.` : `Send it${order.deadlines.handover_by ? ` by ${when(order.deadlines.handover_by)}` : ""} and mark it sent.`;
    case "sent":
      return buyer ? `On its way. Confirm when it arrives${order.deadlines.confirm_by ? `, or it releases on ${when(order.deadlines.confirm_by)}` : ""}.` : `Sent. Paid to you once ${order.with.name} confirms${order.deadlines.confirm_by ? `, or on ${when(order.deadlines.confirm_by)}` : ""}.`;
    case "disputed":
      return "BitoCard is looking at both sides and will decide.";
    case "released":
      return buyer ? "Complete." : "Paid to you: withdrawable after the payout hold.";
    case "refunded":
      return buyer ? "Refunded to your wallet." : "The buyer was refunded.";
    case "partly_refunded":
      return buyer ? "Part refunded to your wallet." : "Part refunded; the rest paid to you.";
    case "declined":
      return buyer ? "The seller declined. You can still chat with them." : "You declined this request.";
    case "lapsed":
      return "Closed: not answered or paid in time.";
    case "cancelled":
      return "Cancelled. Nothing was charged, or it was refunded in full.";
  }
}

/** Status pill colours for orders. */
export function orderTone(status: ShopOrder["status"]) {
  if (status === "released") return "bg-emerald-700 text-white";
  if (["paid", "sent"].includes(status)) return "bg-emerald-50 text-emerald-800";
  if (["requested", "awaiting_payment"].includes(status)) return "bg-amber-50 text-amber-800";
  if (status === "disputed") return "bg-brand-50 text-brand-700";
  return "bg-slate-100 text-slate-700";
}

export type OrderAction = "accept" | "decline" | "pay" | "release_code" | "enter_code" | "sent" | "received" | "cancel" | "dispute";

/** What the reader of an order can do now (the API checks again). */
export function orderActions(order: Pick<ShopOrder, "role" | "status" | "fulfilment" | "dispute">): OrderAction[] {
  const buyer = order.role === "buyer";
  switch (order.status) {
    case "requested":
      return buyer ? ["cancel"] : ["accept", "decline"];
    case "awaiting_payment":
      return buyer ? ["pay", "cancel"] : ["cancel"];
    case "paid":
      if (order.fulfilment === "meet_up") return buyer ? ["release_code", "cancel", "dispute"] : ["enter_code", "cancel"];
      return buyer ? ["cancel", "dispute"] : ["sent", "cancel"];
    case "sent":
      return buyer ? ["received", "dispute"] : [];
    default:
      return [];
  }
}

/** The order's steps for its progress list: done, now or later, with when each happened. */
export function orderSteps(order: Pick<ShopOrder, "status" | "fulfilment" | "timeline" | "with" | "role">) {
  const t = order.timeline;
  const ended = ["declined", "lapsed", "cancelled", "refunded", "partly_refunded"].includes(order.status);
  const steps = [
    { title: "Requested", at: t?.requested_at ?? null },
    { title: order.role === "buyer" ? `Accepted by ${order.with.name}` : "You accepted", at: t?.accepted_at ?? null },
    { title: "Paid: BitoCard is holding it", at: t?.paid_at ?? null },
    ...(order.fulfilment === "delivery" ? [{ title: "Sent", at: t?.sent_at ?? null }] : [{ title: "Met and checked", at: t?.released_at ?? null }]),
    { title: order.role === "buyer" ? "Released to the seller" : "Paid to you", at: t?.released_at ?? null },
  ];
  const now = steps.findIndex(step => !step.at);
  return steps.map((step, index) => ({ ...step, state: step.at ? ("done" as const) : !ended && index === now ? ("now" as const) : ("later" as const) }));
}
