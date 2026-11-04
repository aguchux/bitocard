import type { HomeCard, PersonalRailKind } from './home';

/**
 * udozo.com's personalised discovery (docs/UDOZO_PERSONALISATION_PLAN.md, its API contract): what a person's visit
 * records, and the rows, history and searches chosen for them. Udozo's API, `src/classifieds/discovery/`.
 */

/** Recorded by the browser (`POST /v1/classifieds/events`); the API records saves, chats, contacts, calls, offers and orders itself. */
export const browserEventKinds = ['view', 'engaged', 'search', 'filter', 'result_click', 'rail_click', 'impression', 'share', 'not_interested'] as const;
export const serverEventKinds = ['save', 'unsave', 'chat', 'contact', 'call', 'offer', 'order'] as const;
export type BrowserEventKind = (typeof browserEventKinds)[number];
export type DiscoveryEventKind = BrowserEventKind | (typeof serverEventKinds)[number];

/** One event the browser sends. `listing` is the listing's number (ref). */
export type DiscoveryEvent = {
  kind: BrowserEventKind;
  listing?: number;
  query?: string;
  filters?: Record<string, string | string[]>;
  results?: number;
  sort?: string;
  /** Where a click or impression came from: `search`, `home:<row id>`, `for_you`, `for_you_holdout`, `similar`, `also_viewed`, `recent`. */
  source?: string;
  position?: number;
  /** For `engaged`: seconds on the page while it was visible (at most 600), photos opened, how far down they read (0 to 100). */
  seconds?: number;
  photos?: number;
  depth?: number;
  at?: string;
};
export type DiscoveryEventBatch = { country: string; session: string; events: DiscoveryEvent[] };

export type ForYouKind = PersonalRailKind;
export type ForYouRow = { kind: ForYouKind; title: string; href: string | null; query?: string; items: HomeCard[] };
/** `GET /v1/classifieds/for-you`: `personalised` is false without a profile, for the holdout, or where the switch is off. */
export type ForYou = { object: 'for_you'; personalised: boolean; rows: ForYouRow[] };

/** `GET /v1/classifieds/history`: what is remembered about the person, which they can remove. */
export type DiscoveryHistory = {
  object: 'history';
  personalisation: boolean;
  listings: Array<HomeCard & { viewed_at: string }>;
  searches: Array<{ query: string; searched_at: string }>;
};
