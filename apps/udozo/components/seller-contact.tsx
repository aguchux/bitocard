"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import type { ShopChat, ShopSellerProfile, ShopViewer } from "@bitocard/api-client/classifieds";
import { listingContactState } from "@/lib/listing-actions";
import { ListingActions } from "./listing-actions";

type ContactListing = ShopSellerProfile["contact_listings"][number];

/**
 * The contact panel on a seller's page: the same ways in as on a listing (chat in place, a private call while they are
 * on Udozo, a call back, their contact details), about one of their listings the buyer chooses, since every chat and
 * request names the listing it is about. Choosing another reads what the buyer already has with it.
 */
export function SellerContactPanel({
  cc,
  seller,
  listings,
  first,
  signedIn,
  myPhone,
}: {
  cc: string;
  seller: string;
  listings: ContactListing[];
  first: { viewer: ShopViewer | null; chat: ShopChat | null };
  signedIn: boolean;
  myPhone: string | null;
}) {
  const [chosen, setChosen] = useState(listings[0]?.id ?? "");
  // What the buyer has with the listing the actions are drawn for: the chosen one once it has been read.
  const [state, setState] = useState({ id: listings[0]?.id ?? "", ...first });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const listing = listings.find(item => item.id === chosen) ?? listings[0];
  const shown = listings.find(item => item.id === state.id) ?? listing;

  if (state.viewer?.own) {
    return <p className="rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">This is your seller page: how buyers see you. Manage your listings in My listings.</p>;
  }
  if (!listing) {
    return (
      <p className="flex items-start gap-2 rounded-2xl bg-navy-50 p-3.5 text-sm text-navy-700">
        <MessageCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> {seller} has nothing for sale to ask about right now.
      </p>
    );
  }

  const choose = (id: string) => {
    setChosen(id);
    setError(null);
    if (!signedIn) return setState({ id, viewer: null, chat: null });
    startTransition(async () => {
      const result = await listingContactState(id);
      if (result.ok) setState({ id, ...result.data });
      else {
        setState({ id, viewer: null, chat: null });
        setError(result.message);
      }
    });
  };

  return (
    <div className="grid gap-3">
      {listings.length > 1 ? (
        <label className="grid gap-1.5 text-sm font-semibold">
          About which listing?
          <select value={listing.id} onChange={event => choose(event.target.value)} disabled={pending} className="h-11 w-full min-w-0 rounded-xl border border-navy-200 bg-white px-3 text-sm font-normal focus:border-navy-500">
            {listings.map(item => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-navy-600">
          About <span className="font-semibold text-navy-900">{listing.title}</span>
        </p>
      )}
      {error ? (
        <p className="text-sm text-brand-700" role="alert">
          {error}
        </p>
      ) : null}
      <div aria-busy={pending} className={pending ? "pointer-events-none opacity-60" : ""}>
        <ListingActions
          key={shown.id}
          variant="seller"
          listing={{ id: shown.id, title: shown.title, url: `/${cc}/l/${shown.ref}-${shown.slug}`, currency: shown.currency, active: true, chat: shown.chat, phone: shown.phone, buyPath: `/${cc}/l/${shown.ref}/buy`, buyHref: null, buyLabel: "" }}
          viewer={state.viewer}
          signedIn={signedIn}
          chat={state.chat}
          messagesHref={signedIn ? (state.viewer?.conversation_id ? `/account/messages/${state.viewer.conversation_id}` : "/account/messages") : null}
          myPhone={myPhone}
        />
      </div>
    </div>
  );
}
