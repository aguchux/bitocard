// Shipping a listing through Udozo Connect (docs/UDOZO_CONNECT_PLAN.md, phase 4): the Post an ad form's choice, and the
// line buyers read. Pure: shared by the form, the listing page and their tests (safe in the browser).
import { connectName, type ShopListingConnect, type ShopMyListing, shopMoney } from "@bitocard/api-client/classifieds";
import type { ConnectCentre } from "./connect-centres";
import { fromMinor } from "./shop";

/** What the form holds: on or off, each ticked state's charge as typed, and every centre or those chosen. */
export type ConnectChoice = { enabled: boolean; charges: Record<string, string>; all: boolean; centres: string[] };

export function connectChoiceOf(listing: ShopMyListing | null): ConnectChoice {
  const connect = listing?.connect;
  return {
    enabled: connect?.enabled ?? false,
    charges: Object.fromEntries((connect?.states ?? []).map(item => [item.state.id, item.shipping ? fromMinor(item.shipping) : ""])),
    all: connect?.all_centres ?? true,
    centres: (connect?.centres ?? []).map(item => item.id),
  };
}

/** A state the seller can ship to: one with an open centre, or one already ticked (so it can be unticked). */
export type ConnectStateOption = { id: string; name: string; centres: ConnectCentre[] };

export function connectStateOptions(centres: ConnectCentre[], listing: ShopMyListing | null): ConnectStateOption[] {
  const options = new Map<string, ConnectStateOption>();
  for (const centre of centres) {
    const option = options.get(centre.state.id) ?? { id: centre.state.id, name: centre.state.name, centres: [] };
    option.centres.push(centre);
    options.set(centre.state.id, option);
  }
  for (const item of listing?.connect?.states ?? []) if (!options.has(item.state.id)) options.set(item.state.id, { id: item.state.id, name: item.state.name, centres: [] });
  return [...options.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The ticked states as the save action takes them. */
export const connectStatesField = (choice: ConnectChoice) => Object.entries(choice.charges).map(([state_id, shipping]) => ({ state_id, shipping }));

/** Chosen centres still in a ticked state (unticking a state lets its centres go). */
export const centresWithin = (choice: ConnectChoice, options: ConnectStateOption[]) => {
  const open = new Set(options.filter(option => option.id in choice.charges).flatMap(option => option.centres.map(centre => centre.id)));
  return choice.centres.filter(id => open.has(id));
};

/** The summary step's words for it. */
export function connectSummary(choice: ConnectChoice) {
  if (!choice.enabled) return null;
  const count = Object.keys(choice.charges).length;
  return count ? `Ships through ${connectName} to ${count === 1 ? "1 state" : `${count} states`}` : `Ships through ${connectName}: choose the states`;
}

/** What buyers read on a listing page, or null: the states it ships to through Connect, with their charges. */
export function connectLine(connect: ShopListingConnect | null | undefined, currency: string) {
  if (!connect?.states.length) return null;
  const charge = (minor: number) => (minor ? shopMoney(minor, currency) : "free shipping");
  const charges = new Set(connect.states.map(item => item.shipping));
  if (charges.size === 1) {
    const only = connect.states[0]!.shipping;
    return { title: `Ship to a ${connectName} Centre`, body: `${connect.states.map(item => item.name).join(", ")}: ${charge(only)}.` };
  }
  return { title: `Ship to a ${connectName} Centre`, body: connect.states.map(item => `${item.name} ${charge(item.shipping)}`).join(" · ") };
}
