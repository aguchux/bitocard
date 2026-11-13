import type { ShopListingPage, ShopViewer } from '../shared/classifieds';

import type { SearchParams } from './search-query.ts';

/** The stock line under the title (udozo.com's `StockLine`): how many are left, or out of stock; nothing when unknown or sold. */
export function stockLine(data: Pick<ShopListingPage, 'status' | 'in_stock' | 'available'>): { text: string; out: boolean } | null {
  if (data.status === 'sold') return null;
  if (data.in_stock === false) return { text: 'Out of stock', out: true };
  if (typeof data.available !== 'number') return null;
  if (data.available <= 0) return { text: 'Out of stock', out: true };
  return { text: data.available === 1 ? 'Last one in stock' : `${data.available} in stock`, out: false };
}

/** A request's state on its button: nothing yet, waiting, or declined until the buyer may ask again (udozo.com's `requestState`). */
export function requestState(request: { status: string; ask_again_at?: string | null } | null | undefined, now = Date.now()) {
  if (!request) return 'none' as const;
  if (request.status === 'pending') return 'pending' as const;
  if (request.status === 'declined' && request.ask_again_at && Date.parse(request.ask_again_at) > now) return 'declined' as const;
  return 'none' as const;
}

export type ContactOptions = {
  /** The viewer may contact this seller at all (their own country's market). */
  allowed: boolean;
  chat: boolean;
  call: boolean;
  callback: boolean;
  contact: boolean;
  shared: { phone: string | null; email: string } | null;
};

/**
 * What the contact row offers, as udozo.com's `ListingActions` decides: signed out, a listing that takes calls offers
 * every way (each asking to sign in first); signed in, what the viewer allows. While the viewer is loading, Chat and the
 * seller's page still show, so the row is never empty.
 */
export function contactOptions(data: Pick<ShopListingPage, 'status' | 'contact'>, viewer: ShopViewer | null, signedIn: boolean): ContactOptions {
  const active = data.status === 'active';
  const allowed = !viewer || viewer.can_contact;
  const shared = (allowed && viewer?.contact?.shared) || null;
  const known = signedIn && viewer;
  return {
    allowed,
    chat: Boolean(viewer?.conversation_id) || (data.contact.chat && active),
    call: active && (known ? Boolean(viewer.calls) : !signedIn && data.contact.phone),
    callback: active && (known ? Boolean(viewer.callback?.available) : !signedIn && data.contact.phone),
    contact: active && !shared && (known ? Boolean(viewer.contact?.available) : !signedIn && data.contact.phone),
    shared,
  };
}

/** The search for a listing's place: its area (local first, then outwards) in its state. */
export function placeSearch(data: Pick<ShopListingPage, 'area'>, country: string) {
  return { country, area: data.area.slug, state: data.area.state.slug, place: `${data.area.name}, ${data.area.state.name}` };
}

/** The rails under a listing: the seller's other listings, and listings like it near it. */
export function railSearches(data: Pick<ShopListingPage, 'seller' | 'category' | 'area'>, country: string): { seller: SearchParams | null; similar: SearchParams } {
  const key = data.seller.username || data.seller.handle;
  return {
    seller: key ? { country, seller: key } : null,
    similar: { country, category: data.category.slug, area: data.area.slug, state: data.area.state.slug },
  };
}
