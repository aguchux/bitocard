"use client";

import { useRef, useState } from "react";
import { Flag as FlagIcon, Heart, MessageCircle, Phone, Share2, ShieldCheck, X } from "lucide-react";
import { reportReasonLabels, type ShopChat, type ShopReportReason, type ShopViewer } from "@bitocard/api-client/classifieds";
import { reportListing, saveListing, showPhone } from "@/lib/listing-actions";
import { useAssistantDraft } from "./assistant";
import { ChatPanel } from "./chat-panel";
import { SignInHere } from "./sign-in-here";

type Listing = { id: string; title: string; url: string; currency: string; active: boolean; chat: boolean; phone: boolean; buyPath: string; buyHref: string | null; buyLabel: string };

/** A sheet over the page: from the bottom on phones, centred above (a native modal dialog: Escape closes it). */
function Sheet({ dialog, title, children }: { dialog: React.RefObject<HTMLDialogElement | null>; title: string; children: React.ReactNode }) {
  return (
    <dialog ref={dialog} aria-label={title} className="sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-navy-900 sm:m-auto sm:max-w-md sm:rounded-3xl" onClick={event => event.target === event.currentTarget && event.currentTarget.close()}>
      <div className="grid gap-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="grid size-10 place-items-center rounded-full hover:bg-navy-50" aria-label="Close">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

const button = "flex h-12 items-center justify-center gap-2 rounded-2xl border border-navy-900 bg-white px-4 font-bold text-navy-900 hover:bg-navy-50 disabled:opacity-60";

/** Save to favourites and share (WhatsApp, or the device's share sheet, or copying the link). */
export function SaveShare({ listing, viewer, signedIn }: { listing: Pick<Listing, "id" | "title" | "url">; viewer: ShopViewer | null; signedIn: boolean }) {
  const [saved, setSaved] = useState(viewer?.favourite ?? false);
  const [note, setNote] = useState<string | null>(null);
  const toggle = async () => {
    const next = !saved;
    setSaved(next);
    const result = await saveListing(listing.id, next);
    if (!result.ok) {
      setSaved(!next);
      setNote(result.message);
    }
  };
  const share = async () => {
    const text = `${listing.title} on BitoCard Shop`;
    if (navigator.share) {
      await navigator.share({ title: text, url: listing.url }).catch(() => undefined);
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}: ${listing.url}`)}`, "_blank", "noopener");
  };
  const round = "grid size-11 place-items-center rounded-full border border-navy-200 bg-white text-navy-900 hover:border-navy-500";
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => void share()} className={round} aria-label="Share on WhatsApp or copy link">
        <Share2 className="size-5" aria-hidden="true" />
      </button>
      {viewer?.own ? null : signedIn ? (
        <button type="button" onClick={() => void toggle()} className={round} aria-pressed={saved} aria-label={saved ? "Saved to favourites. Remove" : "Save to favourites"}>
          <Heart className={`size-5 ${saved ? "fill-brand-500 text-brand-500" : ""}`} aria-hidden="true" />
        </button>
      ) : (
        <SignInHere reason="save" className={round} ariaLabel="Save to favourites">
          <Heart className="size-5" aria-hidden="true" />
        </SignInHere>
      )}
      {note ? (
        <span className="text-xs text-brand-700" role="alert">
          {note}
        </span>
      ) : null}
    </div>
  );
}

/**
 * What a buyer can do on a listing: **Buy with Safe pay**, **Chat** in place, **Show phone**, and **Report**. A visitor is
 * asked to sign in first and comes back here.
 */
export function ListingActions({ listing, viewer, signedIn, chat, messagesHref }: { listing: Listing; viewer: ShopViewer | null; signedIn: boolean; chat: ShopChat | null; messagesHref: string | null }) {
  const [chatOpen, setChatOpen] = useState(Boolean(chat));
  const draft = useAssistantDraft(listing.id, () => setChatOpen(true));
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [reason, setReason] = useState<ShopReportReason>("scam");
  const [details, setDetails] = useState("");
  const [reported, setReported] = useState<string | null>(null);
  const phoneSheet = useRef<HTMLDialogElement>(null);
  const reportSheet = useRef<HTMLDialogElement>(null);

  if (viewer?.own) return <p className="rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">This is your listing. Manage it in My Shop.</p>;
  if (!listing.active) return null;
  const canContact = !viewer || viewer.can_contact;

  const reveal = async () => {
    phoneSheet.current?.showModal();
    if (phone) return;
    setPhoneError(null);
    const result = await showPhone(listing.id);
    if (result.ok) setPhone(result.data.phone);
    else setPhoneError(result.message);
  };

  const report = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await reportListing(listing.id, reason, details);
    setReported(result.ok ? "Thank you. Our moderators will look at it." : result.message);
  };

  return (
    <div className="grid gap-3">
      {listing.buyHref ? (
        <a href={listing.buyHref} className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-mint-700 px-4 text-[15px] font-bold text-white hover:bg-mint-500">
          <ShieldCheck className="size-5" aria-hidden="true" /> {listing.buyLabel}
        </a>
      ) : null}
      {canContact ? (
        <div className="grid grid-cols-2 gap-2.5">
          {listing.chat ? (
            signedIn ? (
              <button type="button" onClick={() => setChatOpen(open => !open)} aria-expanded={chatOpen} className={button}>
                <MessageCircle className="size-5" aria-hidden="true" /> Chat
              </button>
            ) : (
              <SignInHere reason="chat" className={button}>
                <MessageCircle className="size-5" aria-hidden="true" /> Chat
              </SignInHere>
            )
          ) : null}
          {listing.phone ? (
            signedIn ? (
              <button type="button" onClick={() => void reveal()} className={button}>
                <Phone className="size-5" aria-hidden="true" /> Show phone
              </button>
            ) : (
              <SignInHere reason="phone" className={button}>
                <Phone className="size-5" aria-hidden="true" /> Show phone
              </SignInHere>
            )
          ) : null}
        </div>
      ) : (
        <p className="rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">You can contact sellers in your own country&apos;s Shop.</p>
      )}
      {chatOpen && signedIn && listing.chat && canContact ? <ChatPanel listingId={listing.id} currency={listing.currency} initial={chat} messagesHref={messagesHref} buyPath={listing.buyPath} draft={draft} /> : null}
      <div className="text-center">
        {signedIn ? (
          <button type="button" onClick={() => reportSheet.current?.showModal()} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-600 hover:underline">
            <FlagIcon className="size-4" aria-hidden="true" /> Report this listing
          </button>
        ) : (
          <SignInHere reason="report" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-navy-600 hover:underline">
            <FlagIcon className="size-4" aria-hidden="true" /> Report this listing
          </SignInHere>
        )}
      </div>

      <Sheet dialog={phoneSheet} title="The seller's phone">
        {phone ? (
          <>
            <a href={`tel:${phone}`} className="text-center text-2xl font-extrabold tracking-wide text-navy-900">
              {phone}
            </a>
            <p className="text-sm text-navy-600">Say you saw it on BitoCard Shop. Never pay before you have seen the item, and never share codes sent to your phone.</p>
            <a href={`tel:${phone}`} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-navy-900 font-bold text-white">
              <Phone className="size-5" aria-hidden="true" /> Call
            </a>
          </>
        ) : phoneError ? (
          <p className="text-sm text-brand-700" role="alert">
            {phoneError}
          </p>
        ) : (
          <p className="text-sm text-navy-600" role="status">
            Getting the number…
          </p>
        )}
      </Sheet>

      <Sheet dialog={reportSheet} title="Report this listing">
        {reported ? (
          <p className="text-sm text-navy-700" role="status">
            {reported}
          </p>
        ) : (
          <form onSubmit={event => void report(event)} className="grid gap-3">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-semibold">What is wrong?</legend>
              {(Object.keys(reportReasonLabels) as ShopReportReason[]).map(key => (
                <label key={key} className="flex min-h-11 items-center gap-3 rounded-xl border border-navy-200 px-3 text-sm has-checked:border-navy-900">
                  <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} className="size-4 accent-navy-900" />
                  {reportReasonLabels[key]}
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1.5 text-sm font-semibold">
              Anything to add (optional)
              <textarea value={details} onChange={event => setDetails(event.target.value)} rows={3} maxLength={1000} className="rounded-xl border border-navy-200 px-3 py-2 font-normal focus:border-navy-500" />
            </label>
            <button type="submit" className="h-12 rounded-2xl bg-navy-900 font-bold text-white">
              Send report
            </button>
          </form>
        )}
      </Sheet>
    </div>
  );
}
