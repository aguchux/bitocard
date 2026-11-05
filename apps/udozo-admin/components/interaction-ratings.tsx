"use client";

import { useState } from "react";
import { ActionDialog, Badge, Button, formatDateTime } from "@bitocard/admin-ui";
import { AppLink } from "@bitocard/admin-ui/shell";
import { interactionTagLabels, type ShopInteractionTag } from "@bitocard/api-client/classifieds";
import { type AdminInteractionRating, useExcludeInteractionRatingMutation } from "@bitocard/api-client/admin";
import { udozoOrigin } from "@/components/theme";

export const channelLabels: Record<AdminInteractionRating["channel"], string> = { chat: "After a chat", call: "After a call", callback: "After a call back", contact: "After a contact request" };
const safety = new Set(["pay_outside", "upfront_payment"]);
export const tagLabel = (tag: string) => interactionTagLabels[tag as ShopInteractionTag] ?? tag;

/** One private rating as admins see it: who rated whom, the scores, tags and note, and leaving it out of the summary. */
export function InteractionRatingItem({ rating, operations, showSeller = true }: { rating: AdminInteractionRating; operations: boolean; showSeller?: boolean }) {
  const [exclude] = useExcludeInteractionRatingMutation();
  const [open, setOpen] = useState(false);
  const excluded = Boolean(rating.excluded);
  return (
    <li className="grid gap-2 rounded-xl border border-line p-3 text-sm">
      <span className="flex flex-wrap items-center gap-2">
        {rating.flagged ? <Badge tone="red">Safety concern</Badge> : null}
        {excluded ? <Badge tone="grey">Left out of the summary</Badge> : null}
        <span className="text-xs text-muted">
          {channelLabels[rating.channel]} · {formatDateTime(rating.created_at)}
        </span>
      </span>
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          Replies <strong>{rating.responsiveness}</strong>/5
        </span>
        <span>
          Helpfulness <strong>{rating.helpfulness}</strong>/5
        </span>
        <span>
          Courtesy <strong>{rating.courtesy}</strong>/5
        </span>
      </span>
      {rating.tags.length ? (
        <span className="flex flex-wrap gap-1.5">
          {rating.tags.map(tag => (
            <Badge key={tag} tone={safety.has(tag) ? "red" : "grey"}>
              {tagLabel(tag)}
            </Badge>
          ))}
        </span>
      ) : null}
      {rating.comment ? <p className="whitespace-pre-wrap break-words text-ink">{rating.comment}</p> : null}
      {rating.excluded?.reason ? <p className="text-xs text-muted">Left out because: {rating.excluded.reason}</p> : null}
      <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span>
          By{" "}
          <AppLink href={`/classifieds/sellers/${rating.rater.id}`} className="font-semibold text-brand-600 hover:underline">
            {rating.rater.name}
          </AppLink>{" "}
          ({rating.rater.email})
        </span>
        {showSeller ? (
          <span>
            About{" "}
            <AppLink href={`/classifieds/sellers/${rating.seller.id}`} className="font-semibold text-brand-600 hover:underline">
              {rating.seller.name}
            </AppLink>
          </span>
        ) : null}
        <a href={`${udozoOrigin()}${rating.listing.path}`} target="_blank" rel="noopener" className="font-semibold text-brand-600 hover:underline">
          {rating.listing.title ?? "The listing"}
        </a>
      </span>
      {operations ? (
        <Button size="sm" variant="ghost" className="w-fit" onClick={() => setOpen(true)}>
          {excluded ? "Put it back in the summary" : "Leave it out of the summary"}
        </Button>
      ) : null}
      {open ? (
        <ActionDialog
          open
          onClose={() => setOpen(false)}
          title={excluded ? "Put this rating back in the summary?" : "Leave this rating out of the summary?"}
          description={excluded ? "It counts in the seller's summary again." : "For ratings that are not genuine (a rival, a friend, someone never in touch). It stays here, and nobody is told."}
          confirmLabel={excluded ? "Put it back" : "Leave it out"}
          tone={excluded ? "primary" : "danger"}
          onConfirm={reason => exclude({ id: rating.id, excluded: !excluded, reason, seller: rating.seller.id }).unwrap()}
        />
      ) : null}
    </li>
  );
}
