import "server-only";
import type { AreaState, ConnectState } from "./connect";
import { apiUrl } from "./site";

type AreasReply = { data: Array<{ id: string; name: string; areas: Array<{ id: string; name: string }> }> };

/**
 * The market's states that take applications (`open` in the apply settings), each with its areas from the public
 * areas list (cached a minute, as the API says). Empty while the API cannot be reached.
 */
export async function openStates(country: string, states: ConnectState[]): Promise<AreaState[]> {
  let reply: AreasReply | null = null;
  try {
    const res = await fetch(apiUrl(`/v1/classifieds/areas?country=${encodeURIComponent(country)}`), { next: { revalidate: 60 } });
    if (res.ok) reply = (await res.json()) as AreasReply;
  } catch {
    reply = null;
  }
  const areas = new Map((reply?.data ?? []).map(state => [state.id, state.areas.map(area => ({ id: area.id, name: area.name }))]));
  return states.filter(state => state.open).map(state => ({ id: state.id, name: state.name, areas: areas.get(state.id) ?? [] }));
}
