/**
 * Wanted requests in the app (udozo.com's /<cc>/wanted/new and /account/wanted): a buyer says what they need and sellers
 * who have it answer with a listing (`POST /v1/classifieds/wanted`, apps/udozo-api/src/classifieds/wanted). The request
 * as the API presents it, the form's rules and body, and what each refusal says. Kept free of React Native so it runs
 * under `node --test`.
 */
import type { ShopListingCard, ShopPrice } from '../shared/classifieds';
import { toMinor } from './listing-form.ts';

/** A wanted request as the API presents it (`classified_wanted_request`). */
export type WantedRequest = {
  object: 'classified_wanted_request';
  id: string;
  number: string;
  words: string;
  details: string | null;
  country: string;
  category: { id: string; slug: string; name: string };
  place: string | null;
  budget: { min: number | null; max: number | null; currency: string; text: string | null };
  conditions: string[];
  condition_text: string | null;
  status: 'open' | 'fulfilled' | 'closed' | 'expired' | 'removed';
  source: 'web' | 'whatsapp';
  mine: boolean;
  buyer: string;
  sellers_told: number;
  responses: number;
  expires_at: string;
  created_at: string;
};

export type WantedCreated = WantedRequest & { matches: ShopListingCard[] };
export type WantedAnswer = { id: string; seller: string; note: string | null; listing: ShopListingCard | null; conversation_id: string | null; created_at: string };
/** The buyer's own request: its answers and listings that may fit. */
export type WantedMine = Omit<WantedRequest, 'responses'> & { mine: true; matches: ShopListingCard[]; responses: WantedAnswer[] };
/** A seller's view of a request they were told about: which of their listings can answer it. */
export type WantedForSeller = WantedRequest & { mine: false; answered: boolean; answer_listing_id: string | null; your_listings: { id: string; ref: number; title: string | null; slug: string | null; price: ShopPrice }[] };
export type WantedView = WantedMine | WantedForSeller;
export type WantedForYou = WantedRequest & { answered: boolean; told_at: string };
export type WantedList<Item = WantedRequest> = { object: 'list'; data: Item[]; total: number };

/** What a request's status says. */
export const wantedStatusText: Record<WantedRequest['status'], string> = {
  open: 'Open',
  fulfilled: 'Found it',
  closed: 'Closed',
  expired: 'Ended',
  removed: 'Removed by Udozo',
};

/** "Ends in 3 days", "Ends today", or how it ended. */
export function wantedWhen(request: Pick<WantedRequest, 'status' | 'expires_at'>, now = Date.now()) {
  if (request.status !== 'open') return wantedStatusText[request.status];
  const days = Math.ceil((new Date(request.expires_at).getTime() - now) / 86_400_000);
  return days <= 0 ? 'Ends today' : days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`;
}

/** The conditions a buyer chooses on the form, as the API stores them (udozo.com's choices). */
export const wantedConditionChoices = [
  { value: 'any', label: 'New or used', conditions: [] as string[] },
  { value: 'new', label: 'New only', conditions: ['new'] },
  { value: 'used', label: 'Used is fine', conditions: ['used', 'untested'] },
] as const;
export type WantedCondition = (typeof wantedConditionChoices)[number]['value'];

/** The form as the screen holds it. */
export type WantedForm = { words: string; categoryId: string | null; stateId: string | null; areaId: string | null; budget: string; condition: WantedCondition; details: string };
export const emptyWanted: WantedForm = { words: '', categoryId: null, stateId: null, areaId: null, budget: '', condition: 'any', details: '' };

/**
 * A request opened from a brand's or a category's page (`/wanted/new?words=<brand>&category=<slug>`): the words filled
 * in (at most 80 characters), and the subcategory with that slug chosen; a top category's slug chooses nothing, as the
 * request needs one of its subcategories.
 */
export function startingWanted(form: WantedForm, tree: { children: { id: string; slug: string }[] }[], start: { words?: string; category?: string }): WantedForm {
  let categoryId = form.categoryId;
  for (const top of tree) for (const child of top.children) if (start.category && child.slug === start.category) categoryId = child.id;
  return { ...form, words: start.words ? start.words.trim().slice(0, 80) : form.words, categoryId };
}

export type WantedProblem = { message: string; param: string };

/** The body `POST /v1/classifieds/wanted` takes, the budget typed in major units and sent in minor units; or what is missing. */
export function wantedBody(form: WantedForm): { body: Record<string, unknown> } | { problem: WantedProblem } {
  const words = form.words.replace(/\s+/g, ' ').trim();
  if (words.length < 3) return { problem: { message: 'Say what you are looking for in a few words.', param: 'words' } };
  if (words.length > 80) return { problem: { message: 'Keep what you are looking for under 80 characters; add the rest as details.', param: 'words' } };
  if (!form.categoryId) return { problem: { message: 'Choose a category.', param: 'category_id' } };
  let budget: number | null = null;
  if (form.budget.trim()) {
    budget = toMinor(form.budget);
    if (budget === null) return { problem: { message: 'Give the most you would pay as an amount, such as 450,000.', param: 'budget_max' } };
  }
  const condition = wantedConditionChoices.find(choice => choice.value === form.condition) ?? wantedConditionChoices[0];
  const details = form.details.trim();
  return {
    body: {
      words,
      category_id: form.categoryId,
      ...(form.areaId ? { area_id: form.areaId } : form.stateId ? { state_id: form.stateId } : {}),
      ...(budget !== null ? { budget_max: budget } : {}),
      ...(condition.conditions.length ? { conditions: [...condition.conditions] } : {}),
      ...(details ? { details: details.slice(0, 300) } : {}),
    },
  };
}

/** What a refusal of a new request says, in words (the API's own message for anything else). */
export function wantedRefusal(code: string, message: string) {
  switch (code) {
    case 'request_prohibited':
      return 'This cannot be asked for on Udozo.';
    case 'too_many_requests':
      return 'You have as many open requests as you can have. Close one you no longer need in My wanted requests, then ask again.';
    case 'request_limit':
      return 'You have made several requests today. Try again tomorrow.';
    case 'wanted_unavailable':
      return 'Requests are not open in your country yet.';
    default:
      return message;
  }
}

/** What the buyer is told once it is posted: how many sellers Udozo told. */
export function wantedToldText(told: number) {
  return told
    ? `We told ${told} seller${told === 1 ? '' : 's'} who sell this. Their answers come to your chats.`
    : 'We will tell sellers who sell this as they post. Their answers come to your chats.';
}
