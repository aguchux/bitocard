// A Connect Centre as its own people see it on connect.udozo.com (docs/UDOZO_CONNECT_PLAN.md, phase 3), and the rules
// for who may do what. Pure: shared by the pages, the actions and the screens. Types match the API's presenters in
// apps/udozo-api/src/connect/centres.service.ts.

export type CentreRole = "owner" | "manager" | "staff";
export type CentreStatus = "active" | "paused" | "closed";

export type Centre = {
  object: "connect_centre";
  id: string;
  /** CC-000123 */
  number: string;
  name: string;
  status: CentreStatus;
  /** By its partner (a holiday, until a day or until they open it) or by Udozo (only Udozo lifts it). */
  paused: { by: "partner" | "udozo"; reason: string | null; until: string | null } | null;
  closed: { at: string | null; reason: string | null } | null;
  country: string;
  state: { id: string; name: string };
  area: { id: string; name: string };
  address: string;
  landmark: string | null;
  latitude: number | null;
  longitude: number | null;
  hours: string;
  phone: string;
  capacity: number;
  photos: string[];
  deposit: { amount: number; currency: string };
  /** How many people work there, and how many storage places are in use. */
  people: number;
  shelves: number;
  created_at: string;
  /** The reader's own role there. */
  role: CentreRole;
};

export type Member = { object: "connect_centre_member"; id: string; role: CentreRole; name: string; email: string; phone: string | null; since: string };
export type Shelf = { object: "connect_shelf"; id: string; code: string; label: string | null; capacity: number | null; active: boolean; position: number };
export type List<T> = { object: "list"; data: T[] };

export const roleWords: Record<CentreRole, string> = { owner: "Owner", manager: "Manager", staff: "Staff" };
export const roleHints: Record<Exclude<CentreRole, "owner">, string> = {
  manager: "Everything but staff and earnings: the centre's details, pauses and storage places.",
  staff: "Receives, shelves and hands over items.",
};
export const statusWords: Record<CentreStatus, string> = { active: "Open", paused: "Paused", closed: "Closed" };

/** Owners and managers change the centre's details, pauses and storage places; staff only read them. */
export const canManage = (role: CentreRole) => role === "owner" || role === "manager";
/** Only the owner adds, changes and removes people. */
export const isOwner = (role: CentreRole) => role === "owner";

/** The centre's places on connect.udozo.com, in the order of its menu. */
export const centreNav = (id: string) => [
  { label: "Overview", href: `/centre/${id}` },
  { label: "Items", href: `/centre/${id}/orders` },
  { label: "Centre", href: `/centre/${id}/settings` },
  { label: "Staff", href: `/centre/${id}/staff` },
  { label: "Storage places", href: `/centre/${id}/shelves` },
];

/** The menu item a path belongs to: the longest matching address, so Overview is current only on its own page. */
export function currentNav(id: string, path: string) {
  const items = centreNav(id);
  return items.filter(item => path === item.href || path.startsWith(`${item.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href ?? items[0]!.href;
}

/** A day the centre reopens on (stored as that day's midnight, UTC), in words: "25 December 2026". */
export const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));

/** Why the centre takes no new orders, in words, or null while it is open. */
export function pauseWords(centre: Pick<Centre, "status" | "paused" | "closed">, day: (iso: string) => string) {
  if (centre.status === "closed") return `Udozo closed this centre${centre.closed?.reason ? `: ${centre.closed.reason}` : "."}`;
  if (!centre.paused) return null;
  if (centre.paused.by === "udozo") return `Udozo paused this centre${centre.paused.reason ? `: ${centre.paused.reason}` : "."} Our team will reopen it.`;
  return `${centre.paused.reason ?? "Paused"}${centre.paused.until ? `, until ${day(centre.paused.until)}` : ", until you open it again"}.`;
}

/** Where the centre is on a map: a Google Maps search for its position (nothing is sent from this page). */
export const mapLink = (centre: Pick<Centre, "latitude" | "longitude">) =>
  centre.latitude !== null && centre.longitude !== null ? `https://www.google.com/maps?q=${centre.latitude},${centre.longitude}` : null;

/** Where `/centre` sends a person: their only centre, a choice of them, or back to their application. */
export function centreHome(centres: Array<Pick<Centre, "id">>): { redirect: string } | { choose: true } {
  if (centres.length === 1) return { redirect: `/centre/${centres[0]!.id}` };
  if (centres.length === 0) return { redirect: "/application" };
  return { choose: true };
}

// ---- The counter: orders coming to the centre and at it (phase 5) ----

export type CounterView = "expected" | "at_centre" | "done";
export const counterViews: Array<{ view: CounterView; label: string }> = [
  { view: "expected", label: "On their way" },
  { view: "at_centre", label: "At the centre" },
  { view: "done", label: "Done" },
];

export type CounterEvent = { status: string; note: string | null; reported_by: string; at: string };
export type CounterOrder = {
  object: "connect_order";
  id: string;
  /** SP-000123: on the parcel's label. */
  number: string;
  status: "paid" | "sent" | "at_centre" | "disputed" | "released" | "refunded" | "partly_refunded";
  listing: { id: string; ref: number; title: string; cover_url: string | null };
  quantity: number;
  seller: { name: string };
  buyer: { name: string };
  courier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  shelf: { id: string; code: string; label: string | null } | null;
  centre_earns: number;
  currency: string;
  dispatch_photos: Array<{ id: string; content_type: string; width: number | null; height: number | null }>;
  events: CounterEvent[];
  release_tries_left: number | null;
  paid_at: string | null;
  sent_at: string | null;
  handover_by: string | null;
  received_at: string | null;
  ready_at: string | null;
  collect_by: string | null;
  released_at: string | null;
};
export type CounterSummary = { object: "connect_counter_summary"; expected: number; to_shelve: number; ready: number; due_today: number; overdue: number };

/** Why staff refuse an item at check-in. */
export const refusalReasons: Array<{ value: "wrong_item" | "damaged" | "missing_parts" | "not_allowed"; label: string }> = [
  { value: "wrong_item", label: "Not the item listed" },
  { value: "damaged", label: "Damaged" },
  { value: "missing_parts", label: "Parts missing" },
  { value: "not_allowed", label: "Not allowed at Connect Centres" },
];

/** Where an order stands, as the centre reads it. */
export function counterStatus(order: Pick<CounterOrder, "status" | "ready_at" | "collect_by">, now = Date.now()) {
  if (order.status === "paid") return "Paid: the seller is to bring it";
  if (order.status === "sent") return "On its way";
  if (order.status === "at_centre") {
    if (!order.ready_at) return "Received: shelve it";
    return order.collect_by && new Date(order.collect_by).getTime() < now ? "Ready: free time to collect is over" : "Ready to collect";
  }
  if (order.status === "disputed") return "With Udozo to decide";
  if (order.status === "released") return "Collected";
  return "Refunded";
}

/** What staff do next with an order at the counter. */
export function counterNext(order: Pick<CounterOrder, "status" | "ready_at">): "receive" | "shelve" | "hand_over" | null {
  if (order.status === "paid" || order.status === "sent") return "receive";
  if (order.status === "at_centre") return order.ready_at ? "hand_over" : "shelve";
  return null;
}

/** A centre step in words, for the order's timeline. */
export const eventWords: Record<string, string> = {
  shipped: "Sent by the seller",
  received: "Received at the centre",
  refused: "Refused at check-in",
  ready: "Shelved: ready to collect",
  collected: "Collected by the buyer",
  collection_refused: "Refused by the buyer at the counter",
  note: "Update",
};
