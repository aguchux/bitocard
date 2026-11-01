"use client";

import { useRef, useState } from "react";
import { Check, Contact, Flag as FlagIcon, Heart, Mail, MessageCircle, Phone, PhoneCall, PhoneIncoming, Share2, ShieldCheck, X } from "lucide-react";
import { reportReasonLabels, type ShopChat, type ShopReportReason, type ShopViewer } from "@bitocard/api-client/classifieds";
import { reportListing, requestContact, saveListing } from "@/lib/listing-actions";
import { useAssistantDraft } from "./assistant";
import { useCalls } from "./calls/call-provider";
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

const button = "flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-navy-900 bg-white px-3 py-2 text-center text-sm leading-tight font-bold text-navy-900 hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-60";

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
    const text = `${listing.title} on Udozo`;
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

/** A request's state on its button: nothing yet, waiting, or declined until the buyer may ask again. */
export function requestState(request: { status: string; ask_again_at?: string | null } | null | undefined, now = Date.now()) {
  if (!request) return "none" as const;
  if (request.status === "pending") return "pending" as const;
  if (request.status === "declined" && request.ask_again_at && Date.parse(request.ask_again_at) > now) return "declined" as const;
  return "none" as const;
}

/** The seller's contact details, once they shared them with this buyer: on every listing of theirs, to them alone. */
export function SellerContact({ shared }: { shared: { phone: string | null; email: string } }) {
  return (
    <section aria-label="The seller's contact details" className="grid gap-2 rounded-2xl border border-mint-500/30 bg-mint-50 p-4 text-navy-900">
      <h2 className="flex items-center gap-2 text-sm font-bold text-mint-700">
        <ShieldCheck className="size-4" aria-hidden="true" /> The seller shared their contact with you
      </h2>
      {shared.phone ? (
        <a href={`tel:${shared.phone}`} className="flex min-h-11 items-center gap-2 font-bold hover:underline">
          <Phone className="size-4 shrink-0" aria-hidden="true" /> {shared.phone}
        </a>
      ) : null}
      <a href={`mailto:${shared.email}`} className="flex min-h-11 items-center gap-2 font-semibold break-all hover:underline">
        <Mail className="size-4 shrink-0" aria-hidden="true" /> {shared.email}
      </a>
      <p className="text-xs text-navy-600">Only you see these. Never pay before you have seen the item, and never share codes sent to your phone.</p>
    </section>
  );
}

const nonce = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`.replace(/\./g, ""));

/** Asking for a call back or the seller's contact: what is shared, an optional note, then sent. */
function RequestSheet({ dialog, kind, listingId, myPhone, onSent }: { dialog: React.RefObject<HTMLDialogElement | null>; kind: "contact" | "callback"; listingId: string; myPhone: string | null; onSent: (status: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [key] = useState(nonce);
  const callback = kind === "callback";
  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await requestContact(listingId, kind, note, key);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setSent(true);
    onSent(result.data.status);
  };
  return (
    <Sheet dialog={dialog} title={callback ? "Ask for a call back" : "Ask for the seller's contact"}>
      {sent ? (
        <p className="text-sm text-navy-700" role="status">
          {callback ? "Sent. The seller has your number and can call you." : "Sent. If the seller accepts, their phone and email will show here."}
        </p>
      ) : (
        <form onSubmit={event => void send(event)} className="grid gap-3">
          <p className="text-sm text-navy-700">
            {callback
              ? `We send your name, your mobile number${myPhone ? ` ending ${myPhone.slice(-4)}` : ""} and your email to the seller with this listing, so they can call you. Nothing is shown on the page.`
              : "If the seller accepts, you will see their phone number and email here, on every listing of theirs. They see only your first name and initial."}
          </p>
          <label className="grid gap-1.5 text-sm font-semibold">
            {callback ? "When is a good time? (optional)" : "A note for the seller (optional)"}
            <textarea value={note} onChange={event => setNote(event.target.value)} rows={2} maxLength={300} className="rounded-xl border border-navy-200 px-3 py-2 font-normal focus:border-navy-500" />
          </label>
          {error ? (
            <p className="text-sm text-brand-700" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" disabled={busy} className="h-12 rounded-2xl bg-navy-900 font-bold text-white disabled:opacity-60">
            {busy ? "Sending…" : callback ? "Ask them to call me" : "Send request"}
          </button>
        </form>
      )}
    </Sheet>
  );
}

/** One way to get in touch: its button, or for a visitor the way to sign in first and come back. */
function Action({ signedIn, label, icon, onClick, reason, disabled, title, expanded }: { signedIn: boolean; label: string; icon: React.ReactNode; onClick: () => void; reason: "chat" | "phone" | "call"; disabled?: boolean; title?: string; expanded?: boolean }) {
  return signedIn ? (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-expanded={expanded} className={button}>
      {icon} {label}
    </button>
  ) : (
    <SignInHere reason={reason} className={button}>
      {icon} {label}
    </SignInHere>
  );
}

/**
 * What a buyer can do on a listing: **Buy with Safe pay**, **Chat with seller** in place, **Call seller** in the browser
 * while the seller is on Udozo (relayed: no numbers shared), **Request call back** (the buyer's details to the seller),
 * **Request contact** (the seller's phone and email, shown here once they accept), and **Report**. Nobody's details are
 * on the page for everyone. A visitor is asked to sign in first and comes back here.
 */
export function ListingActions({ listing, viewer, signedIn, chat, messagesHref, myPhone = null }: { listing: Listing; viewer: ShopViewer | null; signedIn: boolean; chat: ShopChat | null; messagesHref: string | null; myPhone?: string | null }) {
  const [chatOpen, setChatOpen] = useState(Boolean(chat));
  const draft = useAssistantDraft(listing.id, () => setChatOpen(true));
  const calls = useCalls();
  const [contactSent, setContactSent] = useState<string | null>(null);
  const [callbackSent, setCallbackSent] = useState<string | null>(null);
  const [reason, setReason] = useState<ShopReportReason>("scam");
  const [details, setDetails] = useState("");
  const [reported, setReported] = useState<string | null>(null);
  const contactSheet = useRef<HTMLDialogElement>(null);
  const callbackSheet = useRef<HTMLDialogElement>(null);
  const reportSheet = useRef<HTMLDialogElement>(null);

  if (viewer?.own) return <p className="rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">This is your listing. Manage it in My listings.</p>;
  if (!listing.active) return null;
  const canContact = !viewer || viewer.can_contact;
  const shared = viewer?.contact?.shared ?? null;
  const contact = contactSent === "pending" ? "pending" : requestState(viewer?.contact?.request);
  const callback = callbackSent === "pending" ? "pending" : requestState(viewer?.callback?.request);
  // Signed out, a listing that takes calls offers them all (each asks to sign in first).
  const offersCall = signedIn ? Boolean(calls && viewer?.calls) : listing.phone;
  const offersCallback = signedIn ? Boolean(viewer?.callback?.available) : listing.phone;
  const offersContact = signedIn ? Boolean(viewer?.contact?.available) && !shared : listing.phone;
  const online = Boolean(viewer?.seller_online);

  const report = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await reportListing(listing.id, reason, details);
    setReported(result.ok ? "Thank you. Our moderators will look at it." : result.message);
  };

  const callIcon = (
    <span className="relative shrink-0">
      <PhoneCall className="size-5" aria-hidden="true" />
      {online ? <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-mint-500 ring-2 ring-white" aria-hidden="true" /> : null}
    </span>
  );

  return (
    <div className="grid gap-3">
      {listing.buyHref ? (
        <a href={listing.buyHref} className="flex h-13 items-center justify-center gap-2 rounded-2xl bg-mint-700 px-4 text-[15px] font-bold text-white hover:bg-mint-500">
          <ShieldCheck className="size-5" aria-hidden="true" /> {listing.buyLabel}
        </a>
      ) : null}
      {shared && canContact ? <SellerContact shared={shared} /> : null}
      {canContact ? (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {listing.chat ? <Action signedIn={signedIn} label="Chat with seller" icon={<MessageCircle className="size-5 shrink-0" aria-hidden="true" />} onClick={() => setChatOpen(open => !open)} reason="chat" expanded={chatOpen} /> : null}
            {offersCall ? (
              <Action
                signedIn={signedIn}
                label="Call seller"
                icon={callIcon}
                onClick={() => calls?.start({ listing_id: listing.id })}
                reason="call"
                disabled={signedIn && (!online || Boolean(calls?.busy))}
                title={online ? "A private call on Udozo: no numbers shared" : "The seller is not on Udozo right now"}
              />
            ) : null}
            {offersCallback ? (
              <Action
                signedIn={signedIn}
                label={callback === "pending" ? "Call back asked" : "Request call back"}
                icon={callback === "pending" ? <Check className="size-5 shrink-0" aria-hidden="true" /> : <PhoneIncoming className="size-5 shrink-0" aria-hidden="true" />}
                onClick={() => callbackSheet.current?.showModal()}
                reason="phone"
                disabled={callback === "pending"}
              />
            ) : null}
            {offersContact ? (
              <Action
                signedIn={signedIn}
                label={contact === "pending" ? "Contact requested" : contact === "declined" ? "Request declined" : "Request contact"}
                icon={contact === "pending" ? <Check className="size-5 shrink-0" aria-hidden="true" /> : <Contact className="size-5 shrink-0" aria-hidden="true" />}
                onClick={() => contactSheet.current?.showModal()}
                reason="phone"
                disabled={contact !== "none"}
              />
            ) : null}
          </div>
          {signedIn && offersCall ? (
            <p className="text-xs text-navy-600">
              {online ? (
                <>
                  <span className="mr-1.5 inline-block size-2 rounded-full bg-mint-500" aria-hidden="true" />
                  The seller is on Udozo now: call them privately, no numbers shared.
                </>
              ) : (
                "The seller is not on Udozo right now: ask them to call you back, or chat."
              )}
            </p>
          ) : null}
        </>
      ) : (
        <p className="rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">You can contact sellers in your own country&apos;s market.</p>
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

      {signedIn ? <RequestSheet dialog={callbackSheet} kind="callback" listingId={listing.id} myPhone={myPhone} onSent={setCallbackSent} /> : null}
      {signedIn ? <RequestSheet dialog={contactSheet} kind="contact" listingId={listing.id} myPhone={myPhone} onSent={setContactSent} /> : null}

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
