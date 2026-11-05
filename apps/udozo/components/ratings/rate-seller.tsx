"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, Star, X } from "lucide-react";
import { interactionBadTags, interactionGoodTags, interactionSafetyTags, interactionScoreLabels, interactionTagLabels, type ShopInteractionRating, type ShopInteractionScores, type ShopInteractionState, type ShopInteractionTag } from "@bitocard/api-client/classifieds";
import { changeRating, notNow, rateSeller, ratingState } from "@/lib/rating-actions";
import { commentNote, privacyNote, scoreKeys, scoreWords } from "@/lib/ratings";

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));
const tagGroups: Array<{ label: string; tags: readonly ShopInteractionTag[]; safety?: boolean }> = [
  { label: "What went well", tags: interactionGoodTags },
  { label: "What did not", tags: interactionBadTags },
  { label: "Safety", tags: interactionSafetyTags, safety: true },
];

/** One score, 1 to 5, as stars that are radio buttons. */
function Stars({ name, label, value, onChange }: { name: string; label: string; value: number; onChange: (value: number) => void }) {
  return (
    <fieldset className="flex flex-wrap items-center justify-between gap-2">
      <legend className="float-left text-sm font-semibold">{label}</legend>
      <span className="flex items-center gap-0.5">
        {scoreWords.map((word, index) => (
          <label key={word} className="grid size-9 cursor-pointer place-items-center rounded-lg hover:bg-slate-100" title={word}>
            <input type="radio" name={name} value={index + 1} checked={value === index + 1} onChange={() => onChange(index + 1)} className="sr-only" />
            <Star className={`size-6 ${index < value ? "fill-amber-400 text-amber-500" : "text-slate-300"}`} aria-hidden="true" />
            <span className="sr-only">{`${index + 1}: ${word}`}</span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/** Rating how a seller dealt with the buyer (or changing it): three scores, tags and a note for Udozo's team only. */
export function RatingForm({ listingId, seller, existing = null, onDone, onCancel }: { listingId: string; seller: string; existing?: ShopInteractionRating | null; onDone: (rating: ShopInteractionRating) => void; onCancel?: () => void }) {
  const [scores, setScores] = useState<ShopInteractionScores>({ responsiveness: existing?.responsiveness ?? 0, helpfulness: existing?.helpfulness ?? 0, courtesy: existing?.courtesy ?? 0 });
  const [tags, setTags] = useState<ShopInteractionTag[]>(existing?.tags ?? []);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(nonce);
  const toggle = (tag: ShopInteractionTag) => setTags(current => (current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag]));
  const missing = scoreKeys.filter(score => scores[score] < 1);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (missing.length) {
      setError(`Give a score for ${missing.map(score => interactionScoreLabels[score].toLowerCase()).join(" and ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const input = { ...scores, tags, comment };
    const result = existing ? await changeRating(existing.id, input) : await rateSeller(listingId, input, key);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onDone(result.data);
  };

  return (
    <form onSubmit={event => void send(event)} className="grid gap-3" aria-label={`Rate ${seller}`}>
      <p className="text-sm font-semibold">How did {seller} deal with you?</p>
      <div className="grid gap-1">
        {scoreKeys.map(score => (
          <Stars key={score} name={`${listingId}-${score}`} label={interactionScoreLabels[score]} value={scores[score]} onChange={value => setScores(current => ({ ...current, [score]: value }))} />
        ))}
      </div>
      {tagGroups.map(group => (
        <fieldset key={group.label} className="grid gap-1.5">
          <legend className="mb-1 text-xs font-semibold text-slate-600">
            {group.label} <span className="font-normal">(optional)</span>
          </legend>
          <span className="flex flex-wrap gap-1.5">
            {group.tags.map(tag => (
              <button
                key={tag}
                type="button"
                aria-pressed={tags.includes(tag)}
                onClick={() => toggle(tag)}
                className={`min-h-9 rounded-full border px-3 text-sm ${tags.includes(tag) ? (group.safety ? "border-red-600 bg-red-50 font-semibold text-red-800" : "border-navy-900 bg-navy-900 text-white") : "border-slate-300 bg-white"}`}
              >
                {interactionTagLabels[tag]}
              </button>
            ))}
          </span>
        </fieldset>
      ))}
      {tags.some(tag => (interactionSafetyTags as readonly string[]).includes(tag)) ? (
        <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-900">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> Thank you: Udozo&apos;s team will look into it. Never pay before you have seen the item, and keep paying through Udozo where you can.
        </p>
      ) : null}
      <label className="grid gap-1.5 text-sm font-semibold">
        Anything else? <span className="text-xs font-normal text-slate-500">{commentNote}</span>
        <textarea value={comment} onChange={event => setComment(event.target.value)} rows={3} maxLength={500} className="rounded-xl border border-slate-300 px-3 py-2 font-normal focus:border-navy-500" />
      </label>
      <p className="text-xs text-slate-500">{privacyNote}</p>
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-12 flex-1 rounded-2xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60">
          {existing ? "Save changes" : "Send rating"}
        </button>
        {onCancel ? (
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-semibold">
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * A slim card asking the buyer to rate how the seller dealt with them, in a chat, after a call and beside an answered
 * request. Asked only where the API says to (at most one listing a day, never after Not now or a rating), and asking
 * counts. Rate opens the form in place; Not now stops asking about this listing.
 */
export function RateSellerPrompt({ listingId, seller, tone = "light" }: { listingId: string; seller: string; tone?: "light" | "dark" }) {
  const [show, setShow] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let live = true;
    void ratingState(listingId, true).then(result => {
      if (live && result.ok && result.data.prompt) setShow(true);
    });
    return () => {
      live = false;
    };
  }, [listingId]);
  if (done) return <p className={`rounded-2xl p-3 text-sm ${tone === "dark" ? "bg-white/10 text-white" : "bg-mint-50 text-navy-900"}`}>Thank you. Only Udozo sees who said what.</p>;
  if (!show) return null;
  if (open)
    return (
      <div className="rounded-2xl bg-white p-4 text-navy-900 ring-1 ring-slate-200">
        <RatingForm listingId={listingId} seller={seller} onDone={() => setDone(true)} onCancel={() => setOpen(false)} />
      </div>
    );
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-2xl p-3 text-sm ${tone === "dark" ? "bg-white/10 text-white" : "bg-white text-navy-900 ring-1 ring-slate-200"}`}>
      <Star className="size-5 shrink-0 text-amber-500" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <strong>How did {seller} deal with you?</strong> <span className={tone === "dark" ? "text-navy-200" : "text-slate-600"}>Private: they never see who said what.</span>
      </span>
      <button type="button" onClick={() => setOpen(true)} className={`min-h-10 rounded-xl px-3 font-semibold ${tone === "dark" ? "bg-white text-navy-900" : "bg-navy-900 text-white"}`}>
        Rate {seller}
      </button>
      <button
        type="button"
        aria-label="Not now"
        onClick={() => {
          setShow(false);
          void notNow(listingId);
        }}
        className="grid size-10 place-items-center rounded-xl hover:bg-black/5"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * On a listing's page: Rate the seller once the buyer may, or their own rating with Change while it can be changed.
 * `ask` (a request the seller answered): asked as a card with Not now where the API says to ask now (and it counts).
 */
export function RateSellerButton({ listingId, seller, initial = null, ask = false }: { listingId: string; seller: string; initial?: ShopInteractionState | null; ask?: boolean }) {
  const [state, setState] = useState<ShopInteractionState | null>(initial);
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => {
    if (initial) return;
    let live = true;
    void ratingState(listingId, ask).then(result => {
      if (live && result.ok) setAsked(result.data.prompt);
      if (live && result.ok) setState(result.data);
    });
    return () => {
      live = false;
    };
  }, [listingId, initial, ask]);
  if (!state || !state.open) return null;
  const done = (rating: ShopInteractionRating) => {
    setState({ ...state, rating, can_rate: false, reason: "rated", prompt: false });
    setOpen(false);
  };
  if (open) return <RatingForm listingId={listingId} seller={seller} existing={state.rating} onDone={done} onCancel={() => setOpen(false)} />;
  if (state.rating)
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
        <Star className="size-4 fill-amber-400 text-amber-500" aria-hidden="true" /> You rated how {seller} dealt with you.
        {state.rating.can_edit ? (
          <button type="button" onClick={() => setOpen(true)} className="font-semibold text-navy-900 underline-offset-2 hover:underline">
            Change
          </button>
        ) : null}
      </p>
    );
  if (!state.can_rate) return null;
  if (asked)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 text-sm text-navy-900 ring-1 ring-slate-200">
        <Star className="size-5 shrink-0 text-amber-500" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <strong>How did {seller} deal with you?</strong> <span className="text-slate-600">Private: they never see who said what.</span>
        </span>
        <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-xl bg-navy-900 px-3 font-semibold text-white">
          Rate {seller}
        </button>
        <button
          type="button"
          aria-label="Not now"
          onClick={() => {
            setAsked(false);
            void notNow(listingId);
          }}
          className="grid size-10 place-items-center rounded-xl hover:bg-black/5"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
    );
  return (
    <button type="button" onClick={() => setOpen(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 px-4 text-sm font-semibold">
      <Star className="size-4 text-amber-500" aria-hidden="true" /> Rate how {seller} dealt with you
    </button>
  );
}
