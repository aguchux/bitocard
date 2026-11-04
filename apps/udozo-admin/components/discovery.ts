// Words for Reports > Discovery: where a click came from and what each recorded event is.

const sourceLabels: Record<string, string> = {
  search: "Search results",
  for_you: "For you",
  for_you_holdout: "For you (comparison group)",
  similar: "More like this",
  also_viewed: "People also viewed",
  recent: "Recently viewed",
};

/** Where a listing was clicked from: the `source` of a click (`home:<row>` is a home page row). */
export function sourceLabel(source: string): string {
  if (source.startsWith("home:")) return "Home row";
  return sourceLabels[source] ?? source.replace(/_/g, " ");
}

/** What each kind of event is, in words (the browser's, then those the API writes where they happen). */
export const kindLabels: Record<string, string> = {
  view: "Listing opened",
  engaged: "Listing read",
  search: "Search",
  filter: "Filter used",
  result_click: "Search result clicked",
  rail_click: "Row listing clicked",
  impression: "Shown in a row",
  share: "Shared",
  not_interested: "Not interested",
  save: "Saved",
  unsave: "Unsaved",
  chat: "Chat started",
  contact: "Contact or call back asked",
  call: "Call",
  offer: "Offer made",
  order: "Safe pay order",
};

export const kindLabel = (kind: string) => kindLabels[kind] ?? kind.replace(/_/g, " ");

/** A rate (0 to 1) as a percentage with one decimal, or a dash when there is nothing to divide. */
export const rate = (value: number | null) => (value === null ? "—" : `${Math.round(value * 1000) / 10}%`);
