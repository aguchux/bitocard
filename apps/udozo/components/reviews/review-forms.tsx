"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Flag, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { reviewAspectLabels, reviewRatingLabels, reviewReportReasonLabels, reviewStanceLabels, type ShopReview, type ShopReviewAspect, type ShopReviewPost, type ShopReviewRating, type ShopReviewReportReason, type ShopReviewStance, type ShopReviewViewer } from "@bitocard/api-client/classifieds";
import { deleteReply, dismissPurchase, editReview, postReply, reportReview, withdrawReview, writeReview } from "@/lib/review-actions";
import { deletePostQuestion, maxPostBody, maxReviewBody, negativeProblem, negativeQuestion, withdrawQuestion } from "@/lib/reviews";
import { useConfirm } from "../confirm-dialog";
import { ReviewPostItem } from "./review-view";

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));
const aspectKeys = Object.keys(reviewAspectLabels) as ShopReviewAspect[];

/**
 * Rating a purchase (or changing one's review): Positive, Neutral (where the market offers it) or Negative, the parts up
 * or down, and the words. A negative review says why, and is confirmed first.
 */
export function ReviewForm({
  purchaseId,
  seller,
  neutral,
  existing = null,
  onDone,
  dismissible = false,
}: {
  purchaseId: string;
  seller: string;
  neutral: boolean;
  existing?: Pick<ShopReview, "id" | "rating" | "aspects" | "body"> | null;
  onDone?: (review: ShopReview) => void;
  /** Offers Not now (the purchase leaves To review). */
  dismissible?: boolean;
}) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [rating, setRating] = useState<ShopReviewRating | null>(existing?.rating ?? null);
  const [aspects, setAspects] = useState<Record<string, "up" | "down">>(existing ? { ...existing.aspects } : {});
  const [body, setBody] = useState(existing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(nonce);
  const options: ShopReviewRating[] = neutral ? ["positive", "neutral", "negative"] : ["positive", "negative"];
  const toggle = (part: ShopReviewAspect, value: "up" | "down") => setAspects(current => {
    const next = { ...current };
    if (next[part] === value) delete next[part];
    else next[part] = value;
    return next;
  });
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!rating) return setError("Choose how it went.");
    const problem = negativeProblem(rating, body, aspects);
    if (problem) return setError(problem);
    if (rating === "negative" && !existing && !(await confirm(negativeQuestion(seller)))) return;
    setBusy(true);
    setError(null);
    const input = { rating, aspects, body };
    const result = existing ? await editReview(existing.id, input) : await writeReview(purchaseId, input, key);
    setBusy(false);
    if (!result.ok) {
      setKey(nonce());
      return setError(result.message);
    }
    onDone?.(result.data);
    router.refresh();
  };
  const dismiss = async () => {
    setBusy(true);
    const result = await dismissPurchase(purchaseId);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    router.refresh();
  };
  return (
    <form onSubmit={event => void send(event)} className="grid gap-3">
      {dialog}
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-semibold">How was buying from {seller}?</legend>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {options.map(option => (
            <button
              key={option}
              type="button"
              aria-pressed={rating === option}
              onClick={() => setRating(option)}
              className={`min-h-11 rounded-xl border px-4 text-sm font-bold ${rating === option ? (option === "negative" ? "border-red-700 bg-red-700 text-white" : option === "positive" ? "border-emerald-700 bg-emerald-700 text-white" : "border-navy-900 bg-navy-900 text-white") : "border-slate-300 bg-white"}`}
            >
              {reviewRatingLabels[option]}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="grid gap-1.5">
        <legend className="mb-1 text-sm font-semibold">
          The details <span className="font-normal text-slate-500">(optional)</span>
        </legend>
        {aspectKeys.map(part => (
          <div key={part} className="flex items-center justify-between gap-2 text-sm">
            <span>{reviewAspectLabels[part]}</span>
            <span className="flex gap-1.5">
              <button type="button" aria-pressed={aspects[part] === "up"} aria-label={`${reviewAspectLabels[part]}: good`} onClick={() => toggle(part, "up")} className={`grid size-10 place-items-center rounded-xl border ${aspects[part] === "up" ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-slate-300"}`}>
                <ThumbsUp className="size-4" aria-hidden="true" />
              </button>
              <button type="button" aria-pressed={aspects[part] === "down"} aria-label={`${reviewAspectLabels[part]}: not good`} onClick={() => toggle(part, "down")} className={`grid size-10 place-items-center rounded-xl border ${aspects[part] === "down" ? "border-red-700 bg-red-50 text-red-800" : "border-slate-300"}`}>
                <ThumbsDown className="size-4" aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      </fieldset>
      <label className="grid gap-1.5 text-sm font-semibold">
        Your review {rating === "negative" ? "(say what went wrong)" : <span className="font-normal text-slate-500">(optional)</span>}
        <textarea value={body} onChange={event => setBody(event.target.value)} rows={4} maxLength={maxReviewBody} className="rounded-xl border border-slate-300 px-3 py-2 font-normal focus:border-navy-500" />
        <span className="text-xs font-normal text-slate-500">
          {body.length}/{maxReviewBody}. Keep to what happened. Contact details and links are hidden.
        </span>
      </label>
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="min-h-12 flex-1 rounded-2xl bg-navy-900 px-4 font-bold text-white disabled:opacity-60">
          {busy ? "Saving…" : existing ? "Save changes" : "Post review"}
        </button>
        {!existing && dismissible ? (
          <button type="button" disabled={busy} onClick={() => void dismiss()} className="min-h-12 rounded-2xl border border-slate-300 px-4 text-sm font-semibold">
            Not now
          </button>
        ) : null}
      </div>
    </form>
  );
}

/** The author's own review: change it (up to three times in 30 days) or withdraw it. */
export function OwnReviewActions({ review, seller, neutral, canEdit }: { review: ShopReview; seller: string; neutral: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withdraw = async () => {
    if (!(await confirm(withdrawQuestion))) return;
    const result = await withdrawReview(review.id);
    if (!result.ok) return setError(result.message);
    router.refresh();
  };
  if (review.status === "withdrawn" || review.status === "removed") return null;
  return (
    <div className="grid gap-2">
      {dialog}
      {editing ? (
        <ReviewForm purchaseId="" seller={seller} neutral={neutral} existing={review} onDone={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          {canEdit ? (
            <button type="button" onClick={() => setEditing(true)} className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm font-semibold">
              Change review
            </button>
          ) : null}
          <button type="button" onClick={() => void withdraw()} className="min-h-10 rounded-xl border border-red-300 px-3 text-sm font-semibold text-red-800">
            Withdraw
          </button>
        </div>
      )}
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Reporting a review or a post in it: what is wrong and an optional note, for Udozo's moderators. */
function ReportSheet({ dialog, reviewId, postId }: { dialog: React.RefObject<HTMLDialogElement | null>; reviewId: string; postId: string | null }) {
  return (
    <dialog ref={dialog} aria-label="Report" className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md sm:rounded-3xl" onClick={event => event.target === event.currentTarget && event.currentTarget.close()}>
      <ReportBody key={postId ?? "review"} dialog={dialog} reviewId={reviewId} postId={postId} />
    </dialog>
  );
}

function ReportBody({ dialog, reviewId, postId }: { dialog: React.RefObject<HTMLDialogElement | null>; reviewId: string; postId: string | null }) {
  const [reason, setReason] = useState<ShopReviewReportReason>("fake");
  const [details, setDetails] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await reportReview(reviewId, { reason, details, ...(postId ? { post_id: postId } : {}) });
    setDone(result.ok ? "Thank you. Udozo's moderators will look at it." : result.message);
  };
  return (
    <div className="grid gap-3 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{postId ? "Report this reply" : "Report this review"}</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="grid size-10 place-items-center rounded-full hover:bg-navy-50" aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {done ? (
          <p className="text-sm" role="status">
            {done}
          </p>
        ) : (
          <form onSubmit={event => void send(event)} className="grid gap-2">
            {(Object.keys(reviewReportReasonLabels) as ShopReviewReportReason[]).map(key => (
              <label key={key} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 text-sm has-checked:border-navy-900">
                <input type="radio" name="reason" checked={reason === key} onChange={() => setReason(key)} className="size-4 accent-navy-900" />
                {reviewReportReasonLabels[key]}
              </label>
            ))}
            <label className="grid gap-1.5 text-sm font-semibold">
              Anything to add (optional)
              <textarea value={details} onChange={event => setDetails(event.target.value)} rows={2} maxLength={500} className="rounded-xl border border-slate-300 px-3 py-2 font-normal" />
            </label>
            <button type="submit" className="h-12 rounded-2xl bg-navy-900 font-bold text-white">
              Send report
            </button>
          </form>
        )}
    </div>
  );
}

/**
 * A review's whole conversation for a signed-in reader: every post (their own with Delete), Report on the review and on
 * others' posts, and the reply form where they may write (a buyer of the same item says where they stand).
 */
export function ReviewThread({ review, viewer }: { review: ShopReview; viewer: ShopReviewViewer | null }) {
  const router = useRouter();
  const [confirm, dialog] = useConfirm();
  const [body, setBody] = useState("");
  const [stance, setStance] = useState<ShopReviewStance | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(nonce);
  const [reporting, setReporting] = useState<string | null>(null);
  const sheet = useRef<HTMLDialogElement>(null);
  const report = (postId: string | null) => {
    setReporting(postId);
    sheet.current?.showModal();
  };
  const remove = async (post: ShopReviewPost) => {
    if (!(await confirm(deletePostQuestion))) return;
    const result = await deleteReply(post.id);
    if (!result.ok) return setError(result.message);
    router.refresh();
  };
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (viewer?.role === "buyer" && !stance) return setError("Say whether you agree, disagree or are adding context.");
    setBusy(true);
    setError(null);
    const result = await postReply(review.id, { body, ...(stance ? { stance } : {}) }, key);
    setBusy(false);
    setKey(nonce());
    if (!result.ok) return setError(result.message);
    setBody("");
    setStance(null);
    router.refresh();
  };
  return (
    <section aria-label="The conversation" className="grid gap-3">
      {dialog}
      {review.posts.length ? (
        <ol className="grid gap-1.5">
          {review.posts.map(post => (
            <ReviewPostItem key={post.id} post={post}>
              {viewer ? (
                <span className="flex gap-3 text-xs">
                  {post.mine && !post.removed ? (
                    <button type="button" onClick={() => void remove(post)} className="font-semibold text-red-800 hover:underline">
                      Delete
                    </button>
                  ) : null}
                  {!post.mine && !post.removed ? (
                    <button type="button" onClick={() => report(post.id)} className="font-semibold text-slate-600 hover:underline">
                      Report
                    </button>
                  ) : null}
                </span>
              ) : null}
            </ReviewPostItem>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-slate-600">No replies yet.</p>
      )}
      {viewer?.can_post ? (
        <form onSubmit={event => void send(event)} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold">{viewer.role === "seller" ? "Reply to this review" : viewer.role === "reviewer" ? "Add to your review" : "You bought this item from this seller too"}</p>
          {viewer.role === "buyer" ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Where you stand">
              {(Object.keys(reviewStanceLabels) as ShopReviewStance[]).map(item => (
                <button key={item} type="button" aria-pressed={stance === item} onClick={() => setStance(item)} className={`min-h-10 rounded-xl border px-3 text-sm font-semibold ${stance === item ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300"}`}>
                  {item === "agree" ? "I agree" : item === "disagree" ? "I disagree" : "Add context"}
                </button>
              ))}
            </div>
          ) : null}
          <textarea value={body} onChange={event => setBody(event.target.value)} rows={3} maxLength={maxPostBody} required aria-label="Your reply" className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-navy-500" />
          <span className="text-xs text-slate-500">You can write {viewer.posts_left} more time{viewer.posts_left === 1 ? "" : "s"} here. Contact details and links are hidden.</span>
          <button type="submit" disabled={busy || !body.trim()} className="h-11 rounded-xl bg-navy-900 font-bold text-white disabled:opacity-60">
            {busy ? "Sending…" : "Send reply"}
          </button>
        </form>
      ) : viewer?.reason ? (
        <p className="text-xs text-slate-500">{viewer.reason}</p>
      ) : null}
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      {viewer?.can_report ? (
        <button type="button" onClick={() => report(null)} className="inline-flex min-h-11 items-center gap-1.5 justify-self-start text-sm font-semibold text-slate-600 hover:underline">
          <Flag className="size-4" aria-hidden="true" /> Report this review
        </button>
      ) : null}
      {viewer ? <ReportSheet dialog={sheet} reviewId={review.id} postId={reporting} /> : null}
    </section>
  );
}
