"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { shopPriceText } from "@bitocard/api-client/classifieds";
import { answerWanted, closeWanted } from "@/lib/wanted-actions";
import type { WantedForSeller } from "@/lib/wanted";
import { useConfirm } from "../confirm-dialog";

const button = "inline-flex min-h-11 items-center rounded-xl px-4 font-semibold disabled:opacity-60";

/** The buyer closes their request: they found it, or no longer need it (asked first). */
export function CloseWanted({ id }: { id: string }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();
  const close = async (fulfilled: boolean) => {
    const answer = await confirm({
      title: fulfilled ? "Found what you wanted?" : "Close this request?",
      body: "Sellers can no longer answer it. Your chats with those who did stay open.",
      action: fulfilled ? "Yes, I found it" : "Close it",
    });
    if (!answer) return;
    start(async () => {
      const result = await closeWanted(id, fulfilled);
      if (!result.ok) setError(result.message);
      else router.refresh();
    });
  };
  return (
    <div className="grid gap-2">
      {dialog}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void close(true)} className={`${button} bg-mint-700 text-white hover:bg-mint-600`}>
          I found it
        </button>
        <button type="button" disabled={busy} onClick={() => void close(false)} className={`${button} border border-navy-200 hover:border-navy-300`}>
          Close request
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** A seller answers with one of their live listings and a note: it opens their chat with the buyer. */
export function AnswerWanted({ id, listings }: { id: string; listings: WantedForSeller["your_listings"] }) {
  const router = useRouter();
  const [listing, setListing] = useState(listings[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const send = () =>
    start(async () => {
      setError(null);
      const result = await answerWanted(id, listing, note);
      if (!result.ok) setError(result.message);
      else router.push(`/account/messages/${result.conversationId}`);
    });
  return (
    <div className="grid gap-3">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">Answer with</legend>
        {listings.map(item => (
          <label key={item.id} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl border border-navy-200 px-3 has-checked:border-brand-600 has-checked:bg-brand-50">
            <span className="flex min-w-0 items-center gap-2">
              <input type="radio" name="listing" value={item.id} checked={listing === item.id} onChange={() => setListing(item.id)} />
              <span className="truncate">{item.title}</span>
            </span>
            <span className="shrink-0 text-sm text-navy-600">{shopPriceText(item.price)}</span>
          </label>
        ))}
      </fieldset>
      <label className="grid gap-1.5 text-sm font-semibold">
        A note for the buyer (optional)
        <textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={300} className="w-full rounded-xl border border-navy-200 px-3 py-2 text-[15px] font-normal" placeholder="It is available today, in Wuse." />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <button type="button" disabled={busy || !listing} onClick={send} className={`${button} w-fit bg-brand-700 font-bold text-white hover:bg-brand-600`}>
        Send to the buyer
      </button>
    </div>
  );
}
