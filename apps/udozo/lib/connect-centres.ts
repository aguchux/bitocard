import { shopApi } from "./api";
import { chosenOpenMarket, type MarketChoice } from "./market-choice";

/**
 * Udozo Connect Centres (docs/UDOZO_CONNECT_PLAN.md, phase 3): the offices approved to receive items from sellers and
 * hand them to buyers. udozo.com lists the active ones of each market (`GET /v1/connect/centres?country=`, public, a
 * minute in caches) on `/<cc>/connect-centres`.
 */
export type ConnectCentre = {
  object: "connect_centre";
  id: string;
  /** CC-000123 */
  number: string;
  name: string;
  state: { id: string; name: string; slug: string };
  area: { id: string; name: string; slug: string };
  address: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  hours: string;
  phone: string;
  photo: string | null;
};

/** The market's active centres, or none while the API cannot answer (the page then says so, never failing). */
export async function centresOf(cc: string): Promise<{ ok: boolean; centres: ConnectCentre[] }> {
  const result = await shopApi<{ object: "list"; data: ConnectCentre[] }>(`/v1/connect/centres?country=${cc.toUpperCase()}`);
  return result.ok ? { ok: true, centres: result.data.data } : { ok: false, centres: [] };
}

/** Centres grouped by their state, states in name order (the API's order is kept within each). */
export function byState(centres: ConnectCentre[]) {
  const groups = new Map<string, { state: ConnectCentre["state"]; centres: ConnectCentre[] }>();
  for (const centre of centres) {
    const group = groups.get(centre.state.slug) ?? { state: centre.state, centres: [] };
    group.centres.push(centre);
    groups.set(centre.state.slug, group);
  }
  return [...groups.values()].sort((a, b) => a.state.name.localeCompare(b.state.name));
}

/** Where a centre is on a map: a Google Maps search for its position, opened by the visitor (nothing sent from our page). */
export const mapLink = (centre: Pick<ConnectCentre, "latitude" | "longitude">) =>
  centre.latitude !== null && centre.longitude !== null ? `https://www.google.com/maps?q=${centre.latitude},${centre.longitude}` : null;

/** A phone number to call: digits and a leading plus only. */
export const telLink = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

/** Where the help menu's Connect Centres goes: the chosen open market's list, the only market's, or null to choose. */
export function centresPathFor<T extends { country: string }>(choice: MarketChoice, open: T[]) {
  const market = chosenOpenMarket(choice, open) ?? (open.length === 1 ? open[0]! : null);
  return market ? `/${market.country.toLowerCase()}/connect-centres` : null;
}

/** What Post an ad offers for shipping through Udozo Connect: the market's open centres, or null where it is closed. */
export async function connectShippingFor(market: { country: string; connect_shipping?: boolean }) {
  if (!market.connect_shipping) return null;
  return { centres: (await centresOf(market.country)).centres };
}
