"use client";

import { useId, useState } from "react";
import { Button, Dialog, errorMessage, Field, Notice, Select, Textarea } from "@bitocard/admin-ui";
import { type ListingReviewCode, listingReviewCodeLabels, listingReviewCodes, listingReviewCodeText } from "@bitocard/api-client/admin";

/**
 * Sending an ad back (Ask for changes) or removing it (Reject): why, as a reason code, and a note for the seller. The
 * seller reads the note, else the reason's own sentence (shown here first); Other needs a note. Both are audited.
 */
export function ModerateDialog({
  title,
  description,
  confirmLabel,
  tone,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  tone: "primary" | "danger";
  onClose: () => void;
  onConfirm: (input: { reason_code: ListingReviewCode; note: string }) => Promise<unknown>;
}) {
  const id = useId();
  const [code, setCode] = useState<ListingReviewCode | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteNeeded = code === "other";
  const ready = code !== "" && (!noteNeeded || note.trim().length >= 5) && (note.trim().length === 0 || note.trim().length >= 3);
  const reads = note.trim() || (code ? listingReviewCodeText[code] : "");

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone}
            loading={busy}
            disabled={!ready}
            onClick={async () => {
              if (!code) return;
              setBusy(true);
              setError(null);
              try {
                await onConfirm({ reason_code: code, note: note.trim() });
                onClose();
              } catch (failure) {
                setError(errorMessage(failure));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error ? <Notice tone="red">{error}</Notice> : null}
        <Field label="Why" htmlFor={`${id}-code`} hint="Counted in Reports > Posting journeys.">
          <Select id={`${id}-code`} value={code} onChange={event => setCode(event.target.value as ListingReviewCode | "")}>
            <option value="">Choose a reason</option>
            {listingReviewCodes.map(value => (
              <option key={value} value={value}>
                {listingReviewCodeLabels[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={noteNeeded ? "Note for the seller" : "Note for the seller (optional)"} htmlFor={`${id}-note`} hint={noteNeeded ? "Say what to change. At least 5 characters." : "Leave it empty to send the reason's own words."}>
          <Textarea id={`${id}-note`} value={note} onChange={event => setNote(event.target.value)} maxLength={500} />
        </Field>
        {reads ? (
          <div className="rounded-xl bg-canvas p-3 text-sm">
            <p className="text-xs font-semibold text-muted">The seller reads</p>
            <p className="mt-1 text-ink">{reads}</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
